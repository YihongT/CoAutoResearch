<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner you can question, guide, and build with.</strong></p>

<p align="center">Un système de recherche open source associant investigation autonome, auto-amélioration récursive (recursive self-improvement) et collaboration humain–IA. Menez des expériences, affinez les méthodes grâce aux preuves et aux retours, et rédigez des brouillons d’articles à partir d’un historique de recherche traçable.</p>

<p align="center"><a href="#quick-start"><strong>Démarrage rapide →</strong></a> · <a href="#features">Fonctionnalités</a> · <a href="#example-papers">Exemples d’articles</a> · <a href="https://yihongt.github.io/CoAutoResearch/">Documentation</a></p>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <strong>Français</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <a href="README.ar.md">العربية</a></p>

<p align="center"><sub>Il s’agit de traductions du README. L’interface et la documentation complète sont en anglais ; l’agent répond dans votre langue.</sub></p>

![Commencez par une question, une proposition ou un travail déjà engagé.](../assets/homepage.png)

*Commencez par une question, une proposition ou un travail déjà engagé.*

<a id="news"></a>

## 📰 Actualités

- **2026-09-09** — Ajout des articles Digits et Ising, d’améliorations de la reprise de recherche et de contrôles renforcés lors de la génération d’articles.
- **2026-09-07** — La mise à jour des sources 2.0 ajoute des discussions parallèles, des commandes plus claires et la génération d’articles dans le produit.

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

## ✨ Fonctionnalités

**Discutez pendant la recherche.** Explorez des idées dans un échange séparé. Relisez puis envoyez une suggestion lorsque vous souhaitez orienter la recherche.

**Auto-amélioration récursive.** Intégrez les résultats enregistrés, les retours de revue et les enseignements réutilisables à l’essai suivant. Révisez hypothèses, méthodes et décisions dans les limites de vos consignes et de votre budget ; conservez les résultats négatifs et concluez lorsque les preuves le justifient.

**Examinez les éléments probants.** Suivez les résultats, les vérifications et les limites jusqu’au manuscrit et au brouillon d’article.

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

Parcourez un projet Digits terminé : historique de recherche, manuscrit et PDF. Cette visite du navigateur, montée et recadrée, présente un historique existant, pas une nouvelle exécution ni la vitesse réelle de recherche.

<details>
<summary>Trois façons de commencer</summary>

**Une nouvelle question :** « Comparez deux méthodes sur un petit jeu de données public. Utilisez uniquement le CPU, précisez le budget et demandez confirmation avant l’évaluation finale. »

**Un travail existant :** « Lisez ma proposition et les pièces jointes. Identifiez la prochaine expérience utile et préparez un plan à examiner. »

**Un résultat à approfondir :** « Vérifiez si ce résultat résiste à une comparaison plus exigeante. Conservez les résultats d’origine et indiquez les limites. »

</details>

<a id="quick-start"></a>

## 🚀 Démarrage rapide

**Agents de programmation compatibles:** ✓ Codex CLI · ✓ Claude Code

Confiez cette instruction à votre coding agent :

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

La configuration comporte trois contrôles : **le tableau de bord s’ouvre → le coding agent est authentifié et prêt → les outils de rédaction sont prêts**. Effectuez vous-même la connexion interactive au fournisseur. Les modèles et quotas dépendent de votre compte ; la recherche peut demander des dépendances supplémentaires.

<details>
<summary>Démarrage manuel depuis les sources</summary>

Il vous faut Node.js 20+, Python 3.10+, Git et une CLI Codex ou Claude Code installée et authentifiée.

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

Ouvrez l’URL affichée et laissez le serveur actif. Le tableau de bord ne nécessite ni dépendances applicatives ni compilation. Utilisez `--projects-dir /path/to/projects` pour conserver les recherches hors du dépôt.

La génération de PDF nécessite aussi Python 3.12+, quatre compétences scientifiques aux versions fixées, LaTeX et Poppler. Suivez le guide agent setup. Les sources sont utilisables sans publication sur npm.

[Agent setup](../docs/agent-setup.md)

</details>

Première session : **Create project → envoyer les consignes de recherche → vérifier la direction → Start autoresearch**. Précisez les documents, le budget de calcul et les décisions soumises à approbation. Créer un projet ne lance pas la recherche.

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

## 🔄 Fonctionnement

Chaque **Trial** est une itération de recherche délimitée. Le service vérifie les modifications proposées, enregistre les résultats acceptés et décide de poursuivre, de suspendre ou de demander une décision humaine. La vérification interne n’est ni une évaluation externe par les pairs ni la preuve d’une affirmation scientifique.

**Add to research draft** prépare un texte sans l’envoyer ni l’appliquer. **Pause after current turn** demande une pause à la fin d’un tour de l’agent, éventuellement au milieu d’un Trial. **Resume autoresearch** reprend à partir de l’état conservé.

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="Fonctionnement">
</picture>

Schéma de fonctionnement animé ; la durée est illustrative. Des versions statiques sont disponibles. [SVG](../assets/co-auto-light.svg)

<details open>
<summary>🏗️ Explorer l’architecture du système</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="Explorer l’architecture du système">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

## 📄 Exemples d’articles

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="La régularisation par rétrécissement de covariance aide-t-elle à classer des chiffres manuscrits avec peu de données ?"></a><p><strong>La régularisation par rétrécissement de covariance aide-t-elle à classer des chiffres manuscrits avec peu de données ?</strong></p><p>Comparaisons appariées sur petits échantillons et une seule évaluation sur un jeu réservé ; les résultats restent propres à ces données et à ce protocole.</p><p><a href="../docs/_static/examples/digits-paper.pdf">Lire l’article · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="Avec quelle fiabilité un ordinateur portable peut-il estimer une transition de phase d’Ising ?"></a><p><strong>Avec quelle fiabilité un ordinateur portable peut-il estimer une transition de phase d’Ising ?</strong></p><p>Estimation sous budget CPU et diagnostic d’implémentation. Les gains partiels n’ont pas satisfait les critères conjoints ; les graines aléatoires réservées n’ont pas été utilisées.</p><p><a href="../docs/_static/examples/ising-paper.pdf">Lire l’article · PDF</a></p></td>
</tr>
</table>

Ces deux articles sont des brouillons issus d’évaluations réalisées par les développeurs avec intervention humaine, et non des cas d’utilisateurs externes. Leurs limites figurent dans les rapports ; une relecture scientifique humaine est nécessaire avant publication.

Lorsque les résultats vérifiés sont enregistrés et que les agents sont inactifs, choisissez **Generate paper**. L’agent interne mobilise des compétences de rédaction, visualisation, citation et mise en forme éditoriale sur un instantané figé des éléments probants, sans nouvelles expériences.

Ouvrez **Paper** pour zoomer, faire défiler et télécharger le PDF et les sources. Le brouillon précédent reste accessible pendant la génération de son remplacement.

[Exemples d’articles](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

<a id="documentation"></a>

## 📚 Documentation

Les guides liés sont en anglais. Commencez par Setup ou Walkthrough ; consultez FAQ pour les questions courantes et Platforms pour les limites de prise en charge.

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

## 🤝 Communauté

Contribuez en vérifiant une installation, signalant des bugs reproductibles, améliorant les parcours de recherche, maintenant les traductions ou partageant des résultats documentés. Utilisez Issues et lisez le guide de contribution ; signalez les problèmes de sécurité en privé.

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>Citer CoAutoResearch</summary>

Citez le logiciel et indiquez la version ou le commit utilisé.

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

Sous licence Apache 2.0. Les outils et compétences tiers conservent leurs licences et obligations d’attribution.

Contact: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)
