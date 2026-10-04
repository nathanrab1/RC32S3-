#include "RCLink.h"
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_idf_version.h>

RCLinkClass RCLink;

// ---------------------------------------------------------------- Pacote

enum : uint8_t { PKT_CHANNELS = 1, PKT_MESSAGE = 2, PKT_HEARTBEAT = 3 };

struct __attribute__((packed)) PacketHeader {
  uint8_t magic[2];   // 'R', 'C'
  uint8_t version;
  uint8_t type;
  uint16_t network;
  uint16_t seq;
  uint8_t sender;     // último byte do MAC, para descartar repetições
};

struct __attribute__((packed)) ChannelsPacket {
  PacketHeader h;
  int16_t ch[RC_NUM_CHANNELS];  // -1000..1000 (décimos de %)
};

struct __attribute__((packed)) MessagePacket {
  PacketHeader h;
  char name[RC_NAME_LEN];
  float value;
};

static const uint8_t PROTOCOL_VERSION = 1;
static const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
static uint8_t g_selfId = 0;
static portMUX_TYPE g_mux = portMUX_INITIALIZER_UNLOCKED;

static void fillHeader(PacketHeader &h, uint8_t type, uint16_t network, uint16_t seq) {
  h.magic[0] = 'R';
  h.magic[1] = 'C';
  h.version = PROTOCOL_VERSION;
  h.type = type;
  h.network = network;
  h.seq = seq;
  h.sender = g_selfId;
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3
static void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  RCLink.handlePacket(data, len, info->rx_ctrl ? info->rx_ctrl->rssi : -100);
}
#else
static void onEspNowRecv(const uint8_t *mac, const uint8_t *data, int len) {
  RCLink.handlePacket(data, len, -70);
}
#endif

// ---------------------------------------------------------------- Rádio

void RCLinkClass::begin(uint16_t networkId) {
  if (_started) return;
  _network = networkId;

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Long Range: só fala com outros ESP32 em modo LR, com alcance bem maior.
  esp_wifi_set_protocol(WIFI_IF_STA, WIFI_PROTOCOL_LR);

  // O número da rede também escolhe o canal Wi-Fi (1..11).
  uint8_t wifiChannel = 1 + (networkId % 11);
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(wifiChannel, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);
  esp_wifi_set_max_tx_power(84);  // 21 dBm, o máximo permitido

  uint8_t mac[6];
  WiFi.macAddress(mac);
  g_selfId = mac[5];

  if (esp_now_init() != ESP_OK) {
    Serial.println("[RCLink] erro ao iniciar ESP-NOW");
    return;
  }
  esp_now_register_recv_cb(onEspNowRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = wifiChannel;
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

#if ESP_IDF_VERSION >= ESP_IDF_VERSION_VAL(5, 4, 0)
  esp_now_rate_config_t rate = {};
  rate.phymode = WIFI_PHY_MODE_LR;
  rate.rate = WIFI_PHY_RATE_LORA_250K;
  esp_now_set_peer_rate_config(BROADCAST, &rate);
#else
  esp_wifi_config_espnow_rate(WIFI_IF_STA, WIFI_PHY_RATE_LORA_250K);
#endif

  _started = true;
  _linkUp = false;
  for (uint8_t i = 0; i < _actuatorCount; i++) _actuators[i]->applyFailsafe();

  Serial.printf("[RCLink] rede %u, canal Wi-Fi %u, modo Long Range\n", networkId, wifiChannel);
}

void RCLinkClass::sendRaw(const void *data, size_t len) {
  if (!_started) return;
  esp_now_send(BROADCAST, (const uint8_t *)data, len);
}

void RCLinkClass::setChannel(uint8_t ch, float percent) {
  if (ch < 1 || ch > RC_NUM_CHANNELS) return;
  percent = constrain(percent, -100.0f, 100.0f);
  _txChannels[ch - 1] = (int16_t)lroundf(percent * 10.0f);
  _txChannelsUsed = true;
}

void RCLinkClass::sendChannels() {
  ChannelsPacket p;
  fillHeader(p.h, PKT_CHANNELS, _network, _seq++);
  memcpy(p.ch, _txChannels, sizeof(p.ch));
  sendRaw(&p, sizeof(p));
}

void RCLinkClass::sendHeartbeat() {
  PacketHeader h;
  fillHeader(h, PKT_HEARTBEAT, _network, _seq++);
  sendRaw(&h, sizeof(h));
}

void RCLinkClass::sendMessage(const char *name, float value) {
  // Mensagens vão 3 vezes (broadcast não tem confirmação); o receptor
  // descarta as repetições pelo número de sequência.
  if (_pendingCount >= 8) {
    memmove(&_pending[0], &_pending[1], sizeof(Pending) * 7);
    _pendingCount--;
  }
  Pending &m = _pending[_pendingCount++];
  strncpy(m.name, name, RC_NAME_LEN - 1);
  m.name[RC_NAME_LEN - 1] = 0;
  m.value = value;
  m.seq = _seq++;
  m.left = 3;
  _lastResend = 0;  // envia já na próxima chamada de update()
  update();
}

void RCLinkClass::handlePacket(const uint8_t *data, int len, int rssi) {
  if (len < (int)sizeof(PacketHeader)) return;
  const PacketHeader *h = (const PacketHeader *)data;
  if (h->magic[0] != 'R' || h->magic[1] != 'C') return;
  if (h->version != PROTOCOL_VERSION || h->network != _network) return;

  portENTER_CRITICAL(&g_mux);
  _lastPacketAt = millis();
  _rssi = rssi;
  if (h->type == PKT_CHANNELS && len >= (int)sizeof(ChannelsPacket)) {
    const ChannelsPacket *p = (const ChannelsPacket *)data;
    for (int i = 0; i < RC_NUM_CHANNELS; i++) _rxChannels[i] = p->ch[i];
  } else if (h->type == PKT_MESSAGE && len >= (int)sizeof(MessagePacket)) {
    const MessagePacket *p = (const MessagePacket *)data;
    bool repeated = (h->seq == _lastMsgSeq && h->sender == _lastMsgSender);
    uint8_t next = (_inHead + 1) % 8;
    if (!repeated && next != _inTail) {
      memcpy(_inbox[_inHead].name, p->name, RC_NAME_LEN);
      _inbox[_inHead].name[RC_NAME_LEN - 1] = 0;
      _inbox[_inHead].value = p->value;
      _inHead = next;
    }
    _lastMsgSeq = h->seq;
    _lastMsgSender = h->sender;
  }
  portEXIT_CRITICAL(&g_mux);
}

void RCLinkClass::processInbox() {
  while (true) {
    InMsg msg;
    portENTER_CRITICAL(&g_mux);
    bool empty = (_inTail == _inHead);
    if (!empty) {
      msg = _inbox[_inTail];
      _inTail = (_inTail + 1) % 8;
    }
    portEXIT_CRITICAL(&g_mux);
    if (empty) break;
    for (uint8_t i = 0; i < _handlerCount; i++) {
      if (strncmp(_handlers[i].name, msg.name, RC_NAME_LEN) == 0) _handlers[i].fn(msg.value);
    }
  }
}

void RCLinkClass::update() {
  uint32_t now = millis();

  if (_started) {
    // Envio periódico: canais (se usados) ou só um "estou aqui".
    if (_txChannelsUsed) {
      if (now - _lastChannelSend >= RC_CHANNEL_PERIOD) {
        _lastChannelSend = now;
        sendChannels();
      }
    } else if (now - _lastHeartbeat >= RC_HEARTBEAT_MS) {
      _lastHeartbeat = now;
      sendHeartbeat();
    }

    // Repetição das mensagens pendentes, a cada 8 ms.
    if (_pendingCount > 0 && now - _lastResend >= 8) {
      _lastResend = now;
      for (uint8_t i = 0; i < _pendingCount; i++) {
        MessagePacket p;
        fillHeader(p.h, PKT_MESSAGE, _network, _pending[i].seq);
        memcpy(p.name, _pending[i].name, RC_NAME_LEN);
        p.value = _pending[i].value;
        sendRaw(&p, sizeof(p));
        _pending[i].left--;
      }
      uint8_t kept = 0;
      for (uint8_t i = 0; i < _pendingCount; i++) {
        if (_pending[i].left > 0) _pending[kept++] = _pending[i];
      }
      _pendingCount = kept;
    }

    // Detecção de perda / retorno de sinal.
    uint32_t last = _lastPacketAt;
    bool fresh = last != 0 && (now - last) < RC_TIMEOUT_MS;
    if (fresh && !_linkUp) {
      _linkUp = true;
      Serial.println("[RCLink] sinal conectado");
      if (_onRestored) _onRestored();
    } else if (!fresh && _linkUp) {
      _linkUp = false;
      for (uint8_t i = 0; i < RC_NUM_CHANNELS; i++) _rxChannels[i] = 0;
      for (uint8_t i = 0; i < _actuatorCount; i++) _actuators[i]->applyFailsafe();
      Serial.println("[RCLink] sinal perdido - failsafe ativado");
      if (_onLost) _onLost();
    }

    processInbox();
  }

  pollButtons();
}

float RCLinkClass::channel(uint8_t ch) {
  if (ch < 1 || ch > RC_NUM_CHANNELS || !_linkUp) return 0;
  return _rxChannels[ch - 1] / 10.0f;
}

bool RCLinkClass::connected() { return _linkUp; }

int RCLinkClass::signalStrength() {
  if (!_linkUp) return 0;
  // -100 dBm (limite) .. -40 dBm (muito perto) -> 0..100 %
  return constrain(map(_rssi, -100, -40, 0, 100), 0, 100);
}

void RCLinkClass::onMessage(const char *name, RCMessageHandler fn) {
  if (_handlerCount >= RC_MAX_HANDLERS) return;
  Handler &h = _handlers[_handlerCount++];
  strncpy(h.name, name, RC_NAME_LEN - 1);
  h.name[RC_NAME_LEN - 1] = 0;
  h.fn = fn;
}

void RCLinkClass::registerActuator(RCActuator *a) {
  for (uint8_t i = 0; i < _actuatorCount; i++) if (_actuators[i] == a) return;
  if (_actuatorCount < RC_MAX_ACTUATORS) _actuators[_actuatorCount++] = a;
}

// ---------------------------------------------------------------- Botões

void RCLinkClass::onButton(uint8_t pin, RCEventHandler fn) {
  if (_buttonCount >= RC_MAX_BUTTONS) return;
  pinMode(pin, INPUT_PULLUP);
  _buttons[_buttonCount++] = {pin, false, 0, fn};
}

void RCLinkClass::pollButtons() {
  uint32_t now = millis();
  for (uint8_t i = 0; i < _buttonCount; i++) {
    Button &b = _buttons[i];
    bool pressed = digitalRead(b.pin) == LOW;
    if (pressed != b.last && now - b.changedAt > 30) {  // anti-repique
      b.last = pressed;
      b.changedAt = now;
      if (pressed && b.fn) b.fn();
    }
  }
}

// ---------------------------------------------------------------- Servo

static const uint32_t PWM_FREQ = 50;       // 50 Hz = período de 20 ms
static const uint8_t PWM_BITS = 14;

static void writePulseUs(uint8_t pin, int us) {
  uint32_t duty = (uint32_t)us * ((1 << PWM_BITS) - 1) / 20000;
  ledcWrite(pin, duty);
}

void RCServo::begin(uint8_t pin, float minAngle, float maxAngle) {
  _pin = pin;
  _min = constrain(min(minAngle, maxAngle), 0.0f, 180.0f);
  _max = constrain(max(minAngle, maxAngle), 0.0f, 180.0f);
  ledcAttach(pin, PWM_FREQ, PWM_BITS);
  RCLink.registerActuator(this);
  writeAngle((_min + _max) / 2);
}

void RCServo::writeAngle(float degrees) {
  if (_pin < 0) return;
  degrees = constrain(degrees, _min, _max);
  int us = 500 + (int)(degrees * 2000.0f / 180.0f);  // 0° = 500 µs, 180° = 2500 µs
  writePulseUs(_pin, us);
}

void RCServo::angle(float degrees) {
  if (RCLink.failsafeActive()) return;
  writeAngle(degrees);
}

void RCServo::position(float percent) {
  percent = constrain(percent, -100.0f, 100.0f);
  float center = (_min + _max) / 2;
  angle(center + percent / 100.0f * (_max - _min) / 2);
}

void RCServo::applyFailsafe() { writeAngle((_min + _max) / 2); }

// ---------------------------------------------------------------- Motor (ESC)

void RCMotor::begin(uint8_t pin, bool reversible) {
  _pin = pin;
  _reversible = reversible;
  ledcAttach(pin, PWM_FREQ, PWM_BITS);
  RCLink.registerActuator(this);
  // A maioria dos ESCs precisa ver o neutro por ~3 s ao ligar para armar.
  _armUntil = millis() + 3000;
  writeUs(neutralUs());
}

void RCMotor::writeUs(int us) {
  if (_pin < 0) return;
  writePulseUs(_pin, constrain(us, 1000, 2000));
}

void RCMotor::speed(float percent) {
  if (RCLink.failsafeActive() || millis() < _armUntil) {
    writeUs(neutralUs());
    return;
  }
  percent = constrain(percent, -100.0f, 100.0f);
  if (_reversible) {
    writeUs(1500 + (int)(percent * 5));
  } else {
    writeUs(1000 + (int)(max(percent, 0.0f) * 10));
  }
}

void RCMotor::stop() { writeUs(neutralUs()); }

void RCMotor::applyFailsafe() { writeUs(neutralUs()); }

// ---------------------------------------------------------------- Entradas

struct JoyCal { uint8_t pin; int center; };
static JoyCal g_joy[10];
static uint8_t g_joyCount = 0;

static int joystickCenter(uint8_t pin) {
  for (uint8_t i = 0; i < g_joyCount; i++) if (g_joy[i].pin == pin) return g_joy[i].center;
  // Primeira leitura: média de 16 amostras vira o centro (não mexa no
  // joystick ao ligar).
  long sum = 0;
  for (int i = 0; i < 16; i++) sum += analogRead(pin);
  int center = sum / 16;
  if (g_joyCount < 10) g_joy[g_joyCount++] = {pin, center};
  return center;
}

float rcJoystick(uint8_t pin, bool inverted) {
  int center = joystickCenter(pin);
  int raw = analogRead(pin);
  float v;
  if (raw >= center) v = (raw - center) * 100.0f / max(1, 4095 - center);
  else v = (raw - center) * 100.0f / max(1, center);
  if (fabsf(v) < 5) v = 0;  // zona morta
  v = constrain(v, -100.0f, 100.0f);
  return inverted ? -v : v;
}

float rcPot(uint8_t pin) { return analogRead(pin) * 100.0f / 4095.0f; }

static uint32_t g_pullupPins = 0;

bool rcButton(uint8_t pin) {
  if (pin < 32 && !(g_pullupPins & (1UL << pin))) {
    pinMode(pin, INPUT_PULLUP);
    g_pullupPins |= (1UL << pin);
  }
  return digitalRead(pin) == LOW;
}

// ---------------------------------------------------------------- LEDs

static uint32_t g_outputPins = 0;
static uint32_t g_ledState = 0;

void rcLed(uint8_t pin, bool on) {
  if (pin < 32 && !(g_outputPins & (1UL << pin))) {
    pinMode(pin, OUTPUT);
    g_outputPins |= (1UL << pin);
  }
  digitalWrite(pin, on ? HIGH : LOW);
  if (pin < 32) {
    if (on) g_ledState |= (1UL << pin);
    else g_ledState &= ~(1UL << pin);
  }
}

void rcLedToggle(uint8_t pin) {
  bool on = pin < 32 && (g_ledState & (1UL << pin));
  rcLed(pin, !on);
}

void rcBoardLed(uint8_t r, uint8_t g, uint8_t b) {
  // O WS2812 da ESP32-S3-Zero usa ordem RGB (rgbLedWrite assume GRB).
  rgbLedWriteOrdered(RC_BOARD_LED_PIN, LED_COLOR_ORDER_RGB, r, g, b);
}

// ---------------------------------------------------------------- Tempo

void rcWait(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) {
    RCLink.update();
    delay(1);
  }
}

float rcMap(float x, float inMin, float inMax, float outMin, float outMax) {
  if (inMax == inMin) return outMin;
  return (x - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}
