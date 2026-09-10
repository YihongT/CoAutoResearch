<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center">Defina uma pergunta. Execute experimentos. Discuta descobertas. Aprimore o próximo passo.<br>Crie um manuscrito e um rascunho de artigo a partir de evidências rastreáveis.</p>

<p align="center"><a href="#quick-start"><strong>Início rápido →</strong></a> · <a href="#features">Recursos</a> · <a href="#example-papers">Artigos de exemplo</a> · <a href="https://yihongt.github.io/CoAutoResearch/">Documentação</a></p>

<details>
<summary>🌐 Languages</summary>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><strong>Português brasileiro</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>Estas são traduções do README. A interface e a documentação completa estão em inglês; o agente responde no seu idioma.</sub></p>

</details>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<a id="news"></a>

## 📰 Novidades

- **2026-06-23** — [CoAutoResearch v0.1.1](https://github.com/YihongT/CoAutoResearch/releases/tag/v0.1.1) lançado.

<a id="features"></a>

## ✨ Recursos

**Discuta enquanto a pesquisa avança.** Explore ideias em um chat separado. Revise e envie uma sugestão quando quiser que ela oriente a pesquisa.

**Autoaperfeiçoamento recursivo.** Leve resultados registrados, feedback de revisão e lições reutilizáveis para a próxima rodada. Revise hipóteses, métodos e decisões dentro das suas instruções e orçamento; preserve resultados negativos e encerre quando as evidências indicarem.

**Examine as evidências.** Acompanhe resultados, verificações e limitações até o manuscrito e o rascunho do artigo.

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

Explore um projeto Digits concluído: registros, manuscrito e PDF. Este tour editado e recortado do navegador mostra um histórico existente, não uma nova execução nem a velocidade real da pesquisa.

<details>
<summary>Três formas de começar</summary>

**Uma nova pergunta:** “Compare dois métodos em um pequeno conjunto de dados público. Use apenas CPU, indique o orçamento e peça confirmação antes da avaliação final.”

**Trabalho existente:** “Leia minha proposta e os materiais anexos. Identifique o próximo experimento útil e prepare um plano para revisão.”

**Um resultado a investigar:** “Verifique se este achado resiste a uma comparação mais rigorosa. Preserve os resultados originais e relate as limitações.”

</details>

<a id="quick-start"></a>

## 🚀 Início rápido

**Agentes de programação compatíveis:** ✓ Codex CLI · ✓ Claude Code

Dê esta instrução ao seu coding agent:

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

A configuração tem três etapas de verificação: **painel acessível → coding agent autenticado e pronto → ferramentas de artigo prontas**. Faça pessoalmente o login interativo. Modelos e limites dependem da sua conta; a pesquisa pode exigir dependências adicionais.

<details>
<summary>Execução manual a partir do código-fonte</summary>

Você precisa de Node.js 20+, Python 3.10+, Git e uma CLI do Codex ou Claude Code instalada e autenticada.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Abra a URL exibida e mantenha o servidor ativo. O painel não exige dependências de aplicação nem compilação. Use `--projects-dir /path/to/projects` para manter a pesquisa fora do repositório.

Gerar PDF também exige Python 3.12+, quatro habilidades científicas com versões fixadas, LaTeX e Poppler. Siga o guia agent setup. É possível usar o código-fonte sem uma publicação no npm.

[Agent setup](../docs/agent-setup.md)

</details>

Primeira sessão: **Create project → enviar as instruções de pesquisa → revisar a direção → Start autoresearch**. Inclua materiais, orçamento computacional e decisões que exigem aprovação. Criar um projeto não inicia a pesquisa.

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 Como funciona

Cada **Trial** é uma iteração de pesquisa delimitada. O serviço verifica alterações propostas, registra resultados aceitos e decide se deve continuar, pausar ou pedir uma decisão humana. A revisão interna não é revisão externa por pares nem prova de uma afirmação científica.

**Add to research draft** prepara o texto, mas não o envia nem aplica. **Pause after current turn** solicita uma pausa ao final de um turno do agente, possivelmente no meio de um Trial. **Resume autoresearch** continua a partir do estado preservado.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="Como funciona">
</picture>

Fluxo ilustrativo; a duração é esquemática. Versões estáticas estão disponíveis. [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ Explorar a arquitetura do sistema</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="Explorar a arquitetura do sistema">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 Artigos de exemplo

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="A contração da covariância pode ajudar a classificar dígitos manuscritos com poucos dados de treinamento?"></a><p><strong>A contração da covariância pode ajudar a classificar dígitos manuscritos com poucos dados de treinamento?</strong></p><p>Comparações pareadas com amostras pequenas e uma única avaliação em dados reservados; os achados são específicos destes dados e protocolo.</p><p><a href="../docs/_static/examples/digits-paper.pdf">Ler artigo · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="Com que confiabilidade um notebook consegue estimar uma transição de fase de Ising?"></a><p><strong>Com que confiabilidade um notebook consegue estimar uma transição de fase de Ising?</strong></p><p>Estimativa com orçamento de CPU e diagnóstico da implementação. Ganhos parciais não atenderam aos critérios conjuntos; as sementes reservadas não foram usadas.</p><p><a href="../docs/_static/examples/ising-paper.pdf">Ler artigo · PDF</a></p></td>
</tr>
</table>

Os dois artigos são rascunhos de avaliações operadas por desenvolvedores com intervenção humana, não casos de usuários externos. As limitações permanecem nos relatórios; é necessária revisão científica humana antes da publicação.

Com os resultados revisados registrados e os agentes do projeto inativos, escolha **Generate paper**. O agente interno usa habilidades de escrita, visualização, citações e formatação para o veículo de publicação sobre um retrato congelado das evidências, sem executar novos experimentos.

Abra **Paper** para ampliar, rolar e baixar o PDF e o código-fonte. O rascunho anterior continua disponível durante a geração do substituto.

[Artigos de exemplo](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 Documentação

Os guias vinculados estão em inglês. Comece por Setup ou Walkthrough; consulte FAQ para dúvidas comuns e Platforms para os limites de suporte.

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 Comunidade

Ajude a verificar instalações, relatar erros reproduzíveis, melhorar os fluxos de pesquisa, manter traduções ou compartilhar resultados documentados. Use Issues e leia o guia de contribuição; relate problemas de segurança em particular.

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>Citar CoAutoResearch</summary>

Cite o software e registre a versão ou o commit utilizado.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Licenciado sob Apache 2.0. Ferramentas e habilidades de terceiros mantêm suas próprias licenças e exigências de atribuição.

Contato: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
