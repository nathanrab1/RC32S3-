# 🚗 RC32S3

Ambiente de programação em blocos para criar um **carrinho de controle remoto** com duas
**Waveshare ESP32-S3-Zero** que conversam por **ESP-NOW Long Range**.

A tela tem três colunas:

```
🎮 Controle (esquerda)  |  Blocos (meio)  |  🚗 Carrinho (direita)
```

- **🎮 Controle:** joystick, potenciômetro e botões, que enviam pelo rádio.
- **🚗 Carrinho:** recebe pelo rádio e comanda motor (ESC), servo de direção, servo extra e LEDs.
- **Blocos:** escolha a categoria na grade de cima e arraste o bloco para o lado que quiser. Blocos que só
  existem num lado (🎮 ou 🚗 na categoria) não entram no outro.
- Cada lado tem a sua placa, **✔️ Verificar** e **⬆️ Gravar**.

```
web/            App Blockly (Vite) — publicado no GitHub Pages
server/         Gravador local (Node + arduino-cli): compila e grava pela USB
firmware-lib/   Biblioteca Arduino RCLink (rádio, failsafe, servos, ESC, entradas)
```

## Começando

### 1. Gravador (uma vez por computador)

Precisa do [Node.js](https://nodejs.org) 18+.

```sh
cd server
npm run setup   # instala arduino-cli + suporte ao ESP32 (alguns minutos)
npm start       # deixe esta janela aberta
```

### 2. App

- **Online:** abra o endereço do GitHub Pages no **Chrome** ou no **Edge**. Se o navegador perguntar
  se o site pode acessar a rede local, clique em *Permitir*. Isso é o site falando com o gravador.
- **Offline:** rode `npm run build` em `web/` uma vez. Depois o próprio gravador serve o app em
  http://localhost:3232.
- **Desenvolvimento:** `cd web && npm install && npm run dev`.

O indicador no canto superior direito fica **● verde** quando o gravador está pronto.

### 3. Gravar

1. Ligue as placas na USB. No topo de cada lado, escolha a placa do Controle e a do Carrinho.
2. Clique em **⬆️ Gravar** em cada lado.
3. Os dois programas precisam usar o **mesmo número de rede** no bloco "ligar rádio na rede".

### Placas na sala de aula

- Placa nunca usada aparece como **🔌 Placa nova (EA:7C)**: o fim do número de série da placa.
- Ao escolher a placa num lado (ou gravar nela), ela vira **🎮 Controle** ou **🚗 Carrinho**.
- O botão **⋯** ao lado da placa tem:
  - **✏️ Dar nome a esta placa** — ex.: "Azul" ou "Grupo 3", que aparece como "🚗 Carrinho · Azul".
    Use um nome que não muda se a placa trocar de lado e escreva-o numa etiqueta na placa.
  - **⇄ Trocar com o Controle/Carrinho** — as duas placas trocam de lado num clique.
  - **🧹 Esquecer esta placa** — volta a ser placa nova (sem lado e sem nome).
- Os nomes e lados ficam salvos **neste computador** (no navegador).

## Programa inicial

O projeto novo já vem com um teste de rádio que **só precisa de um servo no Carrinho** (GPIO 3):

- **Controle:** envia o canal 1 com valor 1, espera 2 s, envia 0, espera 2 s, e repete. Mostra cada
  valor no Monitor Serial.
- **Carrinho:** a cada canal 1 recebido, mostra o valor no monitor e move o servo de direção: valor 0
  vai para 0°, qualquer outro valor vai para 180°.

Se o servo vai e volta a cada 2 s, o rádio Long Range está funcionando. Para voltar a esse programa,
use **☰ → Novo projeto**. Ele fica em `web/src/default-project.rc32s3.json`: para trocar o projeto
inicial, baixe um projeto pelo app (💾 Baixar) e substitua esse arquivo.

## Ligações sugeridas

| Controle | Pino |
|---|---|
| Joystick VRx (acelerador) | GPIO 1 |
| Joystick VRy (direção) | GPIO 2 |
| Joystick +V / GND | **3V3** / GND (não use 5V!) |
| Botão do farol | GPIO 4 ↔ GND |

| Carrinho | Pino |
|---|---|
| Sinal do ESC | GPIO 5 |
| Sinal do servo de direção | GPIO 6 |
| LED do farol (com resistor de 220 Ω) | GPIO 8 |
| GND do ESC e do servo | GND da placa (obrigatório: GND em comum) |
| 5V do BEC do ESC | 5V da placa (alimenta o ESP) |

- Alimente o servo pelo **5V do BEC/bateria**, nunca pelo 3V3 da placa.
- Analógicos (joystick, potenciômetro): só **GPIO 1 a 10**. O ADC2 não funciona com o rádio ligado.
- O LED colorido da placa fica no GPIO 21 e é usado pelo bloco "LED da placa".

## Como o rádio funciona

| Bloco | O que faz |
|---|---|
| ligar rádio na rede **N** | Liga o ESP-NOW em modo Long Range (250 kbps). O número da rede também escolhe o canal Wi-Fi, então turmas com redes diferentes não se atrapalham. |
| enviar canais (➕/➖) | Vários canais num bloco só, uma linha por canal (1, 2, 3…). Fica no "repetir sempre". |
| enviar no canal **1–8** | Qualquer número, enviado automaticamente 50× por segundo. Para motor e servo, use de -100 a 100 (eles limitam sozinhos). |
| canal **N** controla motor/servo | Bloco solto no Carrinho: o valor do canal vai direto para o motor ou servo (posição -100..100 ou ângulo 0..180). |
| valor do canal **1–8** | Último número recebido (0 quando está sem sinal). |
| quando receber o canal **1–8** | Evento a cada chegada do canal; pegue o número com "valor do canal". |
| quando perder / quando o sinal voltar | Eventos de conexão (sem pacotes por 0,5 s = sinal perdido). |

**Failsafe automático:** se o sinal cair, o motor vai para o neutro e os servos vão para o centro.
Enquanto estiver sem sinal, os comandos de motor e servo são ignorados. Isso vale também ao
ligar, até a primeira conexão.

**ESC:** escolha "com ré" (neutro em 1500 µs, típico de carrinho) ou "só para frente" (parado em
1000 µs). Ao ligar, o motor fica 3 s no neutro para o ESC armar. Alguns ESCs precisam de calibração
pelo manual do fabricante.

## Problemas comuns

- **A placa não aparece na lista:** segure **BOOT**, aperte e solte **RESET**, solte BOOT e clique em 🔄.
- **"Porta ocupada":** feche o Monitor Serial ou o Arduino IDE.
- **As cores do LED da placa estão trocadas:** a ordem de cor muda entre lotes. Ajuste
  `LED_COLOR_ORDER_RGB` em `firmware-lib/RCLink/src/RCLink.cpp`.

## Testes

```sh
cd web && npm test       # arquivo de projeto + C++ com TODOS os blocos e os exemplos (em web/generated/)
cd web && npm run test:e2e   # arrastar blocos no Chrome (precisa do app em http://localhost:3232)
cd web/generated && for s in */; do arduino-cli compile --fqbn esp32:esp32:esp32s3:CDCOnBoot=cdc --library ../../firmware-lib/RCLink "$s"; done
```
