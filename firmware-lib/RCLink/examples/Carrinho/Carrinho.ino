// Carrinho: ESC no GPIO5, servo de direção no GPIO6, farol no GPIO8.
#include <RCLink.h>

RCMotor motor;
RCServo servoDirecao;

void msg_farol(float valorRecebido) {
  rcLedToggle(8);
}

void sinal_perdido() {
  rcBoardLed(255, 0, 0);
}

void sinal_voltou() {
  rcBoardLed(0, 255, 0);
}

void setup() {
  Serial.begin(115200);
  RCLink.onMessage("farol", msg_farol);
  RCLink.onSignalLost(sinal_perdido);
  RCLink.onSignalRestored(sinal_voltou);
  RCLink.begin(1);
  motor.begin(5, true);
  servoDirecao.begin(6, 45, 135);
}

void loop() {
  RCLink.update();
  motor.speed(RCLink.channel(1));
  servoDirecao.position(RCLink.channel(2));
}
