// Controle: joystick no GPIO1 (acelerador) e GPIO2 (direção), botão no GPIO4.
#include <RCLink.h>

void botao_farol() {
  RCLink.sendMessage("farol", 1);
}

void setup() {
  rcSerialBegin(115200);
  RCLink.begin(1);
  RCLink.onButton(4, botao_farol);
}

void loop() {
  RCLink.update();
  RCLink.setChannel(1, rcJoystick(1));
  RCLink.setChannel(2, rcJoystick(2));
}
