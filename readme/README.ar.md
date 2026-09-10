<!-- Translation basis is tracked in readme/translations.json. -->
<p align="center"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/readme-hero-dark.svg">
  <img src="../assets/readme-hero-light.svg" width="1200" alt="CoAutoResearch — autonomous research and human–AI collaboration">
</picture></p>

<p align="center"><strong>An autonomous research partner that self-improves recursively and works with you.</strong></p>

<p align="center" dir="rtl">حدّد سؤالًا. أجرِ التجارب. ناقش النتائج. حسّن الخطوة التالية.<br>ابنِ مسودة بحث ومقال علمي انطلاقًا من أدلة قابلة للتتبع.</p>

<p align="center"><a href="#quick-start"><strong>البدء السريع →</strong></a> · <a href="#features">الميزات</a> · <a href="#example-papers">أمثلة الأوراق</a> · <a href="https://yihongt.github.io/CoAutoResearch/">التوثيق</a></p>

<details>
<summary>🌐 Languages</summary>

<p align="center"><a href="../README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a><br><a href="README.pt-BR.md">Português brasileiro</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a> · <strong>العربية</strong></p>

<p align="center"><sub>هذه ترجمات لملف README. الواجهة والتوثيق الكامل بالإنجليزية، ويجيب الوكيل بلغتك.</sub></p>

</details>

<p align="center"><a href="../LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-d7b775" alt="Apache 2.0"></a> <a href="https://yihongt.github.io/CoAutoResearch/"><img src="https://img.shields.io/badge/docs-get_started-737269" alt="Documentation"></a></p>

<a id="news"></a>

<div dir="rtl">

## 📰 الأخبار

</div>

<div dir="rtl">

- **2026-09-09** — أُضيفت ورقتا Digits وIsing، وتحسينات استعادة البحث، وفحوص أقوى لتوليد الأوراق.
- **2026-09-07** — يضيف تحديث المصدر 2.0 نقاشات بحث متوازية، وأدوات تحكم أوضح، وتوليد الأوراق داخل المنتج.

</div>

[Changelog](../CHANGELOG.md) · [Releases](https://github.com/YihongT/CoAutoResearch/releases)

<a id="features"></a>

<div dir="rtl">

## ✨ الميزات

</div>

<div dir="rtl">

**ناقش أثناء سير البحث.** استكشف الأفكار في محادثة منفصلة. راجع الاقتراح وأرسله عندما تريد توجيه البحث به.

</div>

<div dir="rtl">

**التحسين الذاتي التكراري.** استفد من النتائج المسجلة وملاحظات المراجعة والدروس القابلة لإعادة الاستخدام في الجولة التالية. راجع الفرضيات والطرق والقرارات ضمن متطلباتك وميزانيتك، واحتفظ بالنتائج السلبية، واختتم البحث عندما تبرر الأدلة ذلك.

</div>

<div dir="rtl">

**افحص الأدلة.** تتبع النتائج والفحوص والقيود وصولًا إلى المخطوطة ومسودة الورقة.

</div>

<a href="https://yihongt.github.io/CoAutoResearch/walkthrough.html#screenshots">
<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/browser-tour.png">
  <img src="../assets/browser-tour.gif" alt="Digits: Trial → Manuscript → Paper">
</picture>
</a>

<div dir="rtl">

تصفح مشروع Digits مكتملًا: سجلات البحث والمخطوطة وPDF. تعرض هذه الجولة المحررة والمقتصة من المتصفح سجلًا موجودًا، لا تشغيلًا جديدًا ولا سرعة البحث الفعلية.

</div>

<details>
<summary>ثلاث طرق للبدء</summary>

<div dir="rtl">

**سؤال جديد:** «قارن طريقتين على مجموعة بيانات عامة صغيرة. استخدم CPU فقط، وحدد الميزانية، واطلب التأكيد قبل التقييم النهائي».

</div>

<div dir="rtl">

**عمل موجود:** «اقرأ مقترحي والمواد المرفقة، وحدد التجربة المفيدة التالية، وجهّز خطة للمراجعة».

</div>

<div dir="rtl">

**نتيجة للتحقق:** «تحقق مما إذا كانت هذه النتيجة تصمد أمام مقارنة أقوى. احتفظ بالنتائج الأصلية واذكر القيود».

</div>

</details>

<a id="quick-start"></a>

<div dir="rtl">

## 🚀 البدء السريع

**وكلاء البرمجة المدعومون:** ✓ Codex CLI · ✓ Claude Code

</div>

<div dir="rtl">

أعطِ وكيل البرمجة هذه التعليمات:

</div>

```text
Set up and launch CoAutoResearch from
https://github.com/YihongT/CoAutoResearch.
Follow docs/agent-setup.md, reuse my existing coding-agent login,
configure paper generation, verify the setup, and open the dashboard.
```

<div dir="rtl">

للإعداد ثلاث نقاط تحقق: **فتح لوحة التحكم ← مصادقة وكيل البرمجة وجاهزيته ← جاهزية أدوات الأوراق**. أكمل تسجيل الدخول التفاعلي بنفسك. تعتمد النماذج وحدود الاستخدام على حسابك، وقد يحتاج البحث إلى تبعيات إضافية.

</div>

<details>
<summary>التشغيل اليدوي من المصدر</summary>

<div dir="rtl">

تحتاج إلى Node.js 20+ وPython 3.10+ وGit، وإلى Codex أو Claude Code CLI مثبت ومصادق عليه.

</div>

```bash
git clone https://github.com/YihongT/CoAutoResearch.git
cd CoAutoResearch
node bin/auto-research.js doctor
node bin/auto-research.js ui
```

<div dir="rtl">

افتح عنوان URL المعروض وأبقِ الخادم قيد التشغيل. لا تحتاج اللوحة إلى تثبيت تبعيات تطبيق أو خطوة بناء. استخدم `--projects-dir /path/to/projects` لحفظ البحث خارج المستودع.

</div>

<div dir="rtl">

يحتاج توليد PDF أيضًا إلى Python 3.12+ وأربع مهارات علمية بإصدارات مثبتة وLaTeX وPoppler. اتبع دليل agent setup. يمكن استخدام المصدر دون إصدار منشور على npm.

</div>

[Agent setup](../docs/agent-setup.md)

</details>

<div dir="rtl">

الجلسة الأولى: **Create project ← إرسال موجز البحث ← مراجعة الاتجاه ← Start autoresearch**. حدد المواد وميزانية الحوسبة والقرارات التي تتطلب موافقة. إنشاء المشروع وحده لا يبدأ البحث.

</div>

[Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html) · [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)

<a id="how-it-works"></a>

<div dir="rtl">

## 🔄 آلية العمل

</div>

<div dir="rtl">

كل **Trial** جولة بحث محددة النطاق. يفحص الخادم التغييرات المقترحة، ويسجل النتائج المقبولة، ويقرر المتابعة أو التوقف المؤقت أو طلب قرار بشري. المراجعة الداخلية ليست تحكيمًا علميًا خارجيًا ولا إثباتًا لادعاء علمي.

</div>

<div dir="rtl">

يُحضّر **Add to research draft** النص دون إرساله أو تطبيقه. يطلب **Pause after current turn** التوقف بعد دور الوكيل، وقد يقع ذلك داخل Trial. يتابع **Resume autoresearch** من الحالة المحفوظة.

</div>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../assets/co-auto-light.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../assets/co-auto-dark.gif">
  <img src="../assets/co-auto-light.gif" alt="آلية العمل">
</picture>

<div dir="rtl">

مخطط توضيحي؛ مدة الحركة لا تمثل زمن التنفيذ. تتوفر نسخ ثابتة. [SVG](../assets/co-auto-light.svg)

</div>

<details open>
<summary>🏗️ استكشاف بنية النظام</summary>

<picture>
  <source media="(prefers-reduced-motion: reduce)" srcset="../docs/_static/diagrams/architecture.svg">
  <source media="(prefers-color-scheme: dark)" srcset="../docs/_static/diagrams/architecture-dark.gif">
  <img src="../docs/_static/diagrams/architecture.gif" alt="استكشاف بنية النظام">
</picture>

[Architecture and lifecycle](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)

</details>

<a id="example-papers"></a>

<div dir="rtl">

## 📄 أمثلة الأوراق

</div>

<table>
<tr>
<td width="50%" valign="top"><a href="../docs/_static/examples/digits-paper.pdf"><img src="../docs/_static/examples/digits-preview.png" width="360" alt="هل يساعد تقليص مصفوفة التغاير في تصنيف الأرقام المكتوبة يدويًا ببيانات تدريب قليلة؟"></a><p><strong>هل يساعد تقليص مصفوفة التغاير في تصنيف الأرقام المكتوبة يدويًا ببيانات تدريب قليلة؟</strong></p><p>مقارنات مقترنة لعينات صغيرة وتقييم واحد على بيانات محجوزة؛ النتائج خاصة بهذه البيانات وهذا البروتوكول.</p><p><a href="../docs/_static/examples/digits-paper.pdf">قراءة الورقة · PDF</a></p></td>
<td width="50%" valign="top"><a href="../docs/_static/examples/ising-paper.pdf"><img src="../docs/_static/examples/ising-preview.png" width="360" alt="ما مدى موثوقية تقدير انتقال طور Ising على حاسوب محمول؟"></a><p><strong>ما مدى موثوقية تقدير انتقال طور Ising على حاسوب محمول؟</strong></p><p>تقدير ضمن ميزانية CPU وتشخيص للتنفيذ. لم تحقق التحسينات الجزئية المعايير المشتركة، ولم تُستخدم البذور العشوائية المحجوزة.</p><p><a href="../docs/_static/examples/ising-paper.pdf">قراءة الورقة · PDF</a></p></td>
</tr>
</table>

<div dir="rtl">

الورقتان مسودتان بحثيتان من تقييمات أجراها المطورون مع تدخل بشري، وليستا دراستي حالة لمستخدمين خارجيين. تحتفظ التقارير بقيودها وتحتاج إلى مراجعة علمية بشرية قبل النشر.

</div>

<div dir="rtl">

بعد تسجيل النتائج المراجعة وتوقف وكلاء المشروع عن العمل، اختر **Generate paper**. يستخدم الوكيل الداخلي مهارات الكتابة والتصور والاستشهاد وتنسيق جهة النشر على لقطة أدلة مجمدة، دون تجارب جديدة.

</div>

<div dir="rtl">

افتح **Paper** للتكبير والتمرير وتنزيل PDF والمصدر. تظل المسودة السابقة متاحة أثناء توليد البديل.

</div>

<div dir="rtl">

[أمثلة الأوراق](https://yihongt.github.io/CoAutoResearch/example-papers.html) · [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)

</div>

<a id="documentation"></a>

<div dir="rtl">

## 📚 التوثيق

</div>

<div dir="rtl">

الأدلة المرتبطة بالإنجليزية. ابدأ بـ Setup أو Walkthrough، وراجع FAQ للأسئلة الشائعة وPlatforms لحدود الدعم.

</div>

- [Setup](https://yihongt.github.io/CoAutoResearch/agent-setup.html)
- [Walkthrough](https://yihongt.github.io/CoAutoResearch/walkthrough.html)
- [Paper generation](https://yihongt.github.io/CoAutoResearch/paper-generation.html)
- [FAQ](https://yihongt.github.io/CoAutoResearch/faq.html)
- [Platforms](https://yihongt.github.io/CoAutoResearch/platforms.html)
- [CLI](https://yihongt.github.io/CoAutoResearch/cli.html)
- [Architecture](https://yihongt.github.io/CoAutoResearch/conceptual-framework.html)
- [Upgrades](https://yihongt.github.io/CoAutoResearch/upgrading.html)

<a id="community"></a>

<div dir="rtl">

## 🤝 المجتمع

</div>

<div dir="rtl">

ساهم في التحقق من التثبيت، والإبلاغ عن أخطاء قابلة للتكرار، وتحسين سير البحث، وصيانة الترجمات، أو مشاركة نتائج موثقة. استخدم Issues واقرأ دليل المساهمة؛ أبلغ عن مشكلات الأمان بصورة خاصة.

</div>

[Issues](https://github.com/YihongT/CoAutoResearch/issues) · [Contributing](../CONTRIBUTING.md) · [Translations](../readme/TRANSLATING.md) · [Security](../SECURITY.md) · [Code of conduct](../CODE_OF_CONDUCT.md)

<details>
<summary>الاستشهاد بـ CoAutoResearch</summary>

<div dir="rtl">

استشهد بالبرنامج وسجل الإصدار أو commit المستخدم.

</div>

```bibtex
@software{coautoresearch,
  title = {CoAutoResearch},
  author = {CoAutoResearch contributors},
  url = {https://github.com/YihongT/CoAutoResearch}
}
```

</details>

<div dir="rtl">

الترخيص Apache 2.0. تحتفظ الأدوات والمهارات الخارجية بتراخيصها ومتطلبات نسب العمل إلى أصحابه.

</div>

<div dir="rtl">

التواصل: [yihong.tang@mail.mcgill.ca](mailto:yihong.tang@mail.mcgill.ca)


</div>