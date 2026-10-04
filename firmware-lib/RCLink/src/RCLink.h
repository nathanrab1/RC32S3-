// RCLink — radiocontrole entre ESP32-S3 usando ESP-NOW Long Range.
//
// Feita para o ambiente RC32S3, mas pode ser usada direto no Arduino.
// Toda a parte de rádio, failsafe e temporização fica aqui, para que o
// código gerado pelos blocos seja curto e legível.
//
// Regras principais:
//  - Os dois ESPs usam o mesmo "número da rede" em RCLink.begin(). O canal
//    Wi-Fi é escolhido a partir desse número, então turmas diferentes podem
//    usar redes diferentes sem interferir.
//  - Canais (1..8) carregam valores de -100 a 100 e são enviados 50x por
//    segundo. Mensagens (nome + valor) são enviadas na hora, com repetição.
//  - Failsafe: se nenhum pacote chegar em RC_TIMEOUT_MS, o motor para e os
//    servos vão para a posição de segurança. Enquanto estiver sem sinal,
//    os comandos para motor/servos são ignorados.
//  - RCLink.update() precisa ser chamado sempre no loop() (o código gerado
//    já faz isso, e rcWait() também chama).

#pragma once
#include <Arduino.h>

#define RC_NUM_CHANNELS   8
#define RC_NAME_LEN       16
#define RC_MAX_HANDLERS   16
#define RC_MAX_BUTTONS    8
#define RC_MAX_ACTUATORS  8
#define RC_TIMEOUT_MS     500
#define RC_CHANNEL_PERIOD 20   // 50 Hz
#define RC_HEARTBEAT_MS   100
#define RC_BOARD_LED_PIN  21   // WS2812 da Waveshare ESP32-S3-Zero

typedef void (*RCMessageHandler)(float value);
typedef void (*RCEventHandler)();

// ---------------------------------------------------------------- Atuadores

class RCActuator {
public:
  virtual void applyFailsafe() = 0;
};

class RCServo : public RCActuator {
public:
  // Ângulos mínimo/máximo limitam o curso (útil para a direção).
  void begin(uint8_t pin, float minAngle = 0, float maxAngle = 180);
  void angle(float degrees);         // 0..180 (limitado ao min/max)
  void position(float percent);      // -100..100 -> min..max, 0 = centro
  void applyFailsafe() override;     // vai para o centro
private:
  void writeAngle(float degrees);
  int8_t _pin = -1;
  float _min = 0, _max = 180;
};

class RCMotor : public RCActuator {
public:
  // reversible = true: ESC com ré (neutro em 1500 µs).
  // reversible = false: ESC só para frente (parado em 1000 µs).
  void begin(uint8_t pin, bool reversible);
  void speed(float percent);         // -100..100 (com ré) ou 0..100
  void stop();
  void applyFailsafe() override;     // para o motor
private:
  void writeUs(int us);
  int neutralUs() const { return _reversible ? 1500 : 1000; }
  int8_t _pin = -1;
  bool _reversible = true;
  uint32_t _armUntil = 0;            // segura no neutro para o ESC armar
};

// ---------------------------------------------------------------- Rádio

class RCLinkClass {
public:
  void begin(uint16_t networkId);
  void update();

  // Envio
  void setChannel(uint8_t ch, float percent);
  void sendMessage(const char *name, float value);

  // Recepção
  float channel(uint8_t ch);         // -100..100 (0 quando sem sinal)
  bool connected();
  int signalStrength();              // 0..100 (%), a partir do RSSI
  void onMessage(const char *name, RCMessageHandler fn);
  void onSignalLost(RCEventHandler fn)     { _onLost = fn; }
  void onSignalRestored(RCEventHandler fn) { _onRestored = fn; }

  // Botões com evento "quando apertar"
  void onButton(uint8_t pin, RCEventHandler fn);

  // Failsafe
  bool started() const { return _started; }
  bool failsafeActive() const { return _started && !_linkUp; }
  void registerActuator(RCActuator *a);

  // Chamado pelo callback do ESP-NOW (contexto da tarefa Wi-Fi).
  void handlePacket(const uint8_t *data, int len, int rssi);

private:
  struct Handler { char name[RC_NAME_LEN]; RCMessageHandler fn; };
  struct Button  { uint8_t pin; bool last; uint32_t changedAt; RCEventHandler fn; };
  struct Pending { char name[RC_NAME_LEN]; float value; uint16_t seq; uint8_t left; };

  void sendRaw(const void *data, size_t len);
  void sendChannels();
  void sendHeartbeat();
  void processInbox();
  void pollButtons();

  bool _started = false;
  bool _linkUp = false;
  uint16_t _network = 0;
  uint16_t _seq = 0;

  // TX
  int16_t _txChannels[RC_NUM_CHANNELS] = {0};
  bool _txChannelsUsed = false;
  uint32_t _lastChannelSend = 0;
  uint32_t _lastHeartbeat = 0;
  Pending _pending[8];
  uint8_t _pendingCount = 0;
  uint32_t _lastResend = 0;

  // RX (escrito pela tarefa Wi-Fi, lido no loop)
  volatile int16_t _rxChannels[RC_NUM_CHANNELS] = {0};
  volatile uint32_t _lastPacketAt = 0;
  volatile int _rssi = -100;
  struct InMsg { char name[RC_NAME_LEN]; float value; };
  InMsg _inbox[8];
  volatile uint8_t _inHead = 0, _inTail = 0;
  uint16_t _lastMsgSeq = 0xFFFF;
  uint8_t _lastMsgSender = 0;

  Handler _handlers[RC_MAX_HANDLERS];
  uint8_t _handlerCount = 0;
  Button _buttons[RC_MAX_BUTTONS];
  uint8_t _buttonCount = 0;
  RCActuator *_actuators[RC_MAX_ACTUATORS];
  uint8_t _actuatorCount = 0;

  RCEventHandler _onLost = nullptr;
  RCEventHandler _onRestored = nullptr;
};

extern RCLinkClass RCLink;

// ---------------------------------------------------------------- Ajudantes

float rcJoystick(uint8_t pin, bool inverted = false); // -100..100, centro calibrado
float rcPot(uint8_t pin);                             // 0..100
bool  rcButton(uint8_t pin);                          // true = apertado (ligado ao GND)
void  rcLed(uint8_t pin, bool on);
void  rcLedToggle(uint8_t pin);
void  rcBoardLed(uint8_t r, uint8_t g, uint8_t b);
void  rcWait(uint32_t ms);                            // espera sem travar o rádio
float rcMap(float x, float inMin, float inMax, float outMin, float outMax);
