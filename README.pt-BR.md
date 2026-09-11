# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center"><img src="assets/readme/bbbbb-logo.svg" width="128" alt="bbbbb"></p>

**Receba um aviso quando precisar agir.**

O bbbbb (“B-five”) reúne resultados de builds, perguntas de agentes de programação e pedidos de aprovação de deploy em uma caixa de entrada privada no iPhone. Você pode consultar as atualizações no app mesmo depois de perder uma notificação.

Pendências mantém perguntas, falhas, aprovações e tarefas até serem resolvidas. O restante aparece em Atividade. As fontes podem enviar, mas não podem ler a caixa de entrada nem executar comandos.

<p align="center"><a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016"><img src="assets/readme/download-on-the-app-store.svg" height="60" alt="App Store"></a></p>

[bbbbb.app](https://bbbbb.app/?lang=pt-BR)

## Em breve: v1.5

O app terá inglês, chinês simplificado, espanhol, japonês, alemão, francês e português do Brasil, além de melhorias no armazenamento do histórico e na exportação CSV. O site já está disponível nos sete idiomas. A atualização do app ainda não foi publicada na App Store.

## Comece aqui

Peça ao agente de programação: `Set up bbbbb at bbbbb.app/setup`. Ele prepara uma fonte HTTP. Escaneie o QR code temporário ou digite o código de seis dígitos no iPhone e aprove a conexão. O agente salva o link privado e envia uma mensagem de teste. Para apps e automações, use “Conectar um app ou automação” no iPhone.

Depois de configurar, envie diretamente com a variável `BBBBB_SOURCE_URL` salva. O emissor escolhe a categoria: Pendências quando precisar de uma resposta; caso contrário, Atividade. Não coloque URLs de fontes em prompts ou logs.

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

### CLI opcional

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

Se npm não estiver disponível, use uma [versão verificada do GitHub](https://github.com/xxsang/bbbbb/releases). Consulte o [guia da CLI](https://bbbbb.app/docs/cli-source/?lang=pt-BR).

### Skill para agentes de programação

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

Depois de instalar, peça ao agente:

> Use o bbbbb nesta tarefa. Avise quando terminar. Envie Attention somente se eu precisar agir. Não envie atualizações de progresso.

## Guias

[macOS](https://bbbbb.app/docs/macos/?lang=pt-BR) · [Linux](https://bbbbb.app/docs/linux/?lang=pt-BR) · [Windows](https://bbbbb.app/docs/windows/?lang=pt-BR) · [HTTP](https://bbbbb.app/docs/http-source/?lang=pt-BR) · [CLI](https://bbbbb.app/docs/cli-source/?lang=pt-BR)

## Planos e limites

O plano Grátis inclui todos os recursos essenciais: 1.000 atualizações nos últimos 30 dias, com armazenamento criptografado das 100 mais recentes por até sete dias para recuperação após ficar offline.

O Plus custa US$ 4,99 em compra única nos primeiros 60 dias após o lançamento, incluindo recursos futuros. Não é uma assinatura. A partir de 26 de outubro de 2026, o preço normal será US$ 6,99, pago uma vez. A App Store mostra o preço local atual.

O Plus aumenta a cota para 10.000 atualizações, guarda as 500 mais recentes por até 30 dias e permite exportar JSON e CSV no dispositivo. O plano Grátis continua disponível.

Não há cota diária. Cada caixa de entrada tem um limite de segurança compartilhado de 20 envios por minuto. Adicionar fontes não aumenta a capacidade.

## Privacidade

Eventos CLI são criptografados antes do envio; eventos HTTP, antes do armazenamento. Fontes não podem ler o histórico. As notificações não mostram detalhes das mensagens. O conteúdo dos emissores é mantido como foi enviado, sem tradução.

Os componentes básicos para desenvolvedores usam a [licença Apache 2.0](LICENSE). O app para iPhone é separado.

<sub>Apple, o logotipo da Apple e App Store são marcas da Apple Inc., registradas nos Estados Unidos e em outros países e regiões.</sub>
