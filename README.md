# Centre Focus CRM

تطبيق CRM داخلي لمركز فوكس (أسفي) لإدارة التلاميذ المحتملين والمسجَّلين: جهات الاتصال، تذكيرات المواعيد عبر واتساب، أتمتة المتابعة، وتقويم محتوى فيسبوك/إنستغرام. يعمل على الحاسوب والهاتف عبر المتصفح، بثلاث لغات (الفرنسية افتراضيًا، العربية RTL، الإنجليزية) ومع وضع داكن كامل.

| الطبقة | التقنيات |
| --- | --- |
| الواجهة الخلفية | Django 5.2 · Django REST Framework · PostgreSQL 16 |
| الواجهة الأمامية | React 19 · TypeScript · Vite · TanStack Query · react-i18next |
| المصادقة | جلسة Django (بريد إلكتروني + كلمة مرور، CSRF)، بدون تسجيل ذاتي |
| النشر | Docker Compose: ‏PostgreSQL + Django/gunicorn + worker + Nginx |

---

## 1. بنية المشروع

```
.
├── backend/                 Django + DRF
│   ├── config/              الإعدادات (كلها عبر متغيرات البيئة)
│   ├── accounts/            نموذج المستخدم (تسجيل الدخول بالبريد الإلكتروني)
│   └── crm/
│       ├── models.py        Contact, Appointment, InteractionLog, FollowUpRule, ContentPost …
│       ├── phone.py         توحيد الأرقام المغربية (+212 6XX XXXXXX)
│       ├── messaging.py     قائمة انتظار رسائل واتساب + مزوّد Meta Cloud API
│       ├── automations.py   محرّك قواعد «إذا… ثم… بعد…»
│       ├── ai.py            توليد مسودات المنشورات عبر Claude
│       ├── management/commands/
│       │   ├── run_worker.py      إرسال الرسائل وتشغيل الأتمتة (حلقة دائمة)
│       │   ├── ensure_admin.py    إنشاء أول حساب من متغيرات البيئة
│       │   ├── import_contacts.py استيراد البيانات القديمة من CSV
│       │   └── seed_demo.py       بيانات تجريبية (للتطوير فقط)
│       └── tests/           66 اختبارًا
├── frontend/                React + TypeScript
│   ├── src/styles/tokens.css    نظام التصميم (ألوان، خطوط، مسافات، الوضع الداكن)
│   ├── src/i18n/locales/        fr.json · ar.json · en.json
│   ├── src/components/ui/       المكوّنات المشتركة
│   ├── src/pages/               الشاشات
│   └── nginx.conf               إعداد Nginx للإنتاج
├── whatsapp-gateway/        خدمة ربط واتساب برمز QR (Node.js + whatsapp-web.js)
├── docker-compose.yml       الإنتاج
├── docker-compose.dev.yml   PostgreSQL فقط للتطوير المحلي
└── .env.example
```

---

## 2. التشغيل محليًا (التطوير)

**المتطلبات:** Python 3.12+، ‏Node.js 22 (أو 20.19+)، ‏Docker (لقاعدة البيانات فقط).

### قاعدة البيانات

```bash
docker compose -f docker-compose.dev.yml up -d      # PostgreSQL على 127.0.0.1:5440
```

### الواجهة الخلفية

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt

export DJANGO_DEBUG=1                 # الإعدادات الافتراضية تشير إلى قاعدة 5440
python manage.py migrate
DJANGO_ADMIN_EMAIL=moi@centrefocus.ma DJANGO_ADMIN_PASSWORD='MotDePasse-Solide-1' \
  python manage.py ensure_admin       # أو: python manage.py createsuperuser
python manage.py seed_demo            # اختياري: 36 جهة اتصال ومواعيد وقواعد ومنشورات تجريبية
python manage.py runserver            # http://127.0.0.1:8000
```

في نافذة طرفية ثانية (لإرسال الرسائل المنتظرة وتشغيل الأتمتة):

```bash
cd backend && source .venv/bin/activate
DJANGO_DEBUG=1 python manage.py run_worker
```

بدون الـ worker تبقى الرسائل في حالة «قيد الانتظار». في التطوير يكون `MESSAGING_BACKEND=console` افتراضيًا: الرسائل تُكتب في سجل الـ worker ولا تُرسل فعليًا.

### الواجهة الأمامية

```bash
cd frontend
npm install
npm run dev                           # http://localhost:5173
```

يمرّر Vite الطلبات `/api` و`/admin` و`/media` إلى Django، فيرى المتصفح أصلًا واحدًا وتعمل ملفات تعريف الجلسة وCSRF مباشرة. لتغيير العنوان: `VITE_API_PROXY=http://127.0.0.1:8030 npm run dev`.

### الاختبارات والتدقيق

```bash
cd backend  && DJANGO_DEBUG=1 python manage.py test crm && ruff check .
cd frontend && npm run typecheck && npm run lint && npm run build
```

مفاتيح الترجمة مُنمَّطة (typed): أي مفتاح غير موجود في `fr.json` يُسقط `npm run typecheck`.

---

## 3. النشر على الخادم عبر Docker

```bash
git clone <repo> focus-crm && cd focus-crm
cp .env.example .env
nano .env                             # املأ القيم المعلَّمة بـ change-me
docker compose up -d --build
docker compose ps                     # يجب أن تكون backend «healthy»
```

الخدمات:

| الخدمة | الدور |
| --- | --- |
| `db` | PostgreSQL 16 (المجلد `pgdata`) |
| `backend` | Django عبر gunicorn؛ يطبّق الترحيلات وينشئ الحساب الأول عند الإقلاع |
| `worker` | يرسل رسائل واتساب المنتظرة (فحص كل ثانيتين) ويقيّم قواعد الأتمتة كل دقيقة |
| `web` | Nginx: يخدم واجهة React، ويمرّر `/api` و`/admin` و`/static` إلى Django، ويخدم الملفات المرفوعة من `/media` |

يُنشر التطبيق افتراضيًا على `127.0.0.1:8200` فقط (`HTTP_BIND` و`HTTP_PORT` في `.env`). ضع أمامه reverse proxy مع HTTPS، مثلًا بـ Nginx:

```nginx
server {
    server_name crm.centrefocus.ma;
    client_max_body_size 60m;
    location / {
        proxy_pass http://127.0.0.1:8200;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    # listen 443 ssl; … (شهادة Let's Encrypt عبر certbot)
}
```

> **إذا كان الـ reverse proxy نفسه يعمل داخل حاوية Docker** (كما هو الحال مع بعض الخدمات على خادمك)، فإن `127.0.0.1` داخلها يشير إلى الحاوية نفسها. اربط المنفذ على جسر Docker بوضع `HTTP_BIND=172.17.0.1` في `.env`، واستعمل `proxy_pass http://172.17.0.1:8200;`.

ثم في `.env`:

```env
DJANGO_ALLOWED_HOSTS=crm.centrefocus.ma
DJANGO_CSRF_TRUSTED_ORIGINS=https://crm.centrefocus.ma
DJANGO_BEHIND_HTTPS_PROXY=1
DJANGO_SECURE_COOKIES=1
```

**ملاحظة حول `.env`:** يفسّر Docker Compose الرمز `$` داخل القيم كمتغيّر. تجنّبه في كلمات المرور أو ضع القيمة بين علامتَي اقتباس مفردتين: `POSTGRES_PASSWORD='abc$123'`. باقي الرموز (`@ / : #`) لا مشكلة فيها.

### النشر الحالي: crm.centrefocus.ma

على خادم المركز، يعمل CRM كمشروع Compose باسم `focus-crm` من المجلد `/home/ubuntu/CRM` على `172.17.0.1:8200`، خلف Nginx الموجود (حاوية `formationfocus-nginx`) مثل باقي النطاقات الفرعية. إعداده الكامل (HTTP + HTTPS) في [deploy/crm.centrefocus.ma.conf](deploy/crm.centrefocus.ma.conf) ويُنسخ إلى `/home/ubuntu/formationFocus/docker/nginx/conf.d/crm.conf`. الشهادة تُصدر بنفس آلية certbot webroot ويجددها `certbot-renew.timer` تلقائيًا:

```bash
docker run --rm \
  -v /home/ubuntu/formationFocus/docker/certbot/conf:/etc/letsencrypt \
  -v /home/ubuntu/formationFocus/docker/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot -w /var/www/certbot -d crm.centrefocus.ma --non-interactive --agree-tos
cp deploy/crm.centrefocus.ma.conf /home/ubuntu/formationFocus/docker/nginx/conf.d/crm.conf
docker exec formationfocus-nginx nginx -t && docker exec formationfocus-nginx nginx -s reload
```

### البيانات التجريبية

```bash
docker compose exec backend python manage.py seed_demo            # إنشاء
docker compose exec backend python manage.py seed_demo --delete   # حذف
```

جهات الاتصال التجريبية تحمل الوسم «Démo» وأرقامها عشوائية **قد تخص أشخاصًا حقيقيين**: احذف البيانات التجريبية قبل ربط واتساب. `--delete` لا يحذف إلا البيانات التجريبية (جهات الاتصال الموسومة، والقواعد والمنشورات التجريبية).

ما دام `MESSAGING_BACKEND=console`، تعرض صفحتا التذكيرات والأتمتة شريط «وضع التجربة»: الرسائل تُسجَّل ولا تُرسل فعليًا.

### العمليات اليومية

```bash
# تحديث الإصدار
git pull && docker compose up -d --build

# إضافة موظف أو تغيير كلمة مرور
docker compose exec backend python manage.py createsuperuser
docker compose exec backend python manage.py changepassword moi@centrefocus.ma
# أو من لوحة الإدارة: https://crm.centrefocus.ma/admin/

# استيراد البيانات القديمة (CSV بترميز UTF-8)
docker compose cp anciens.csv backend:/tmp/anciens.csv
docker compose exec backend python manage.py import_contacts /tmp/anciens.csv --dry-run
docker compose exec backend python manage.py import_contacts /tmp/anciens.csv

# نسخ احتياطي لقاعدة البيانات والملفات المرفوعة
docker compose exec -T db pg_dump -U focus focus_crm | gzip > backup-$(date +%F).sql.gz
docker run --rm -v focus-crm_media:/m -v "$PWD":/b alpine tar czf /b/media-$(date +%F).tgz -C /m .

# السجلات
docker compose logs -f backend worker
```

أعمدة ملف CSV للاستيراد: `first_name, last_name, phone, city, subject, level, status, source, consent, registered_at` (الإلزامي فقط `first_name` و`phone`). تُوحَّد الأرقام تلقائيًا، وتُتجاهل الأرقام الموجودة مسبقًا، وتأخذ جهات الاتصال المصدر «بيانات قديمة» افتراضيًا. التواريخ بصيغة `2024-09-15` أو `15/09/2024`.

---

## 4. واتساب

للإرسال ثلاثة أوضاع (`MESSAGING_BACKEND`):

| الوضع | ما يحدث |
| --- | --- |
| `whatsapp_web` (المفعّل حاليًا) | ربط حساب واتساب بمسح رمز QR من صفحة «WhatsApp» في الـ CRM (مثل WhatsApp Web)، ثم يُرسل الـ CRM مباشرة من ذلك الرقم ويسجّل ردود جهات الاتصال في سجلها. **غير رسمي**: استعمل رقمًا ثانويًا وأعدادًا قليلة. التفاصيل أدناه. |
| `manual` | لا يحتاج أي ربط بـ Meta. تُحضَّر كل رسالة مخصّصة وتُفتح في واتساب (الهاتف أو WhatsApp Web) جاهزة، فتضغط «إرسال» بنفسك ويُسجَّل الإرسال تلقائيًا. الرسائل المنتظرة (يدوية، تذكيرات، أتمتة) تظهر في «Messages à envoyer» بصفحة التذكيرات مع زر «Ouvrir le suivant»، وعددها على أيقونة التذكيرات. إن فُتحت رسالة دون إرسالها، أعدها بزر التراجع. |
| `whatsapp_cloud` | إرسال تلقائي عبر WhatsApp Business Cloud API (الخطوات أدناه). |
| `console` | تسجيل فقط دون إرسال (للتطوير والاختبارات). |

### ربط حساب واتساب برمز QR (`whatsapp_web`)

- **الخدمة:** يعمل الربط عبر خدمة `whatsapp` داخلية مبنية على [whatsapp-web.js](https://wwebjs.dev)، تشغّل WhatsApp Web الحقيقي داخل Chromium مخفي، بلا منفذ منشور للخارج. تُفعَّل بالمتغيرات `MESSAGING_BACKEND=whatsapp_web` و`COMPOSE_PROFILES=whatsapp-web` و`WHATSAPP_GATEWAY_TOKEN`.
- **الربط:** في الـ CRM افتح «WhatsApp» (أسفل القائمة)، ثم على الهاتف: واتساب ← الأجهزة المرتبطة ← ربط جهاز، وامسح الرمز. يظهر الحساب على الهاتف باسم «Centre Focus CRM»، ويمكن فكّه من الهاتف أو من زر «Déconnecter WhatsApp».
- **الحماية من الحظر (افتراضيًا):**
  - 40 رسالة يوميًا كحد أقصى (`WA_WEB_DAILY_LIMIT`).
  - فاصل عشوائي بين 20 و45 ثانية (`WA_WEB_MIN/MAX_DELAY_SECONDS`).
  - مؤشر «يكتب…» قبل كل رسالة.
  - تخطّي الأرقام غير المسجّلة في واتساب.
  - لا إرسال إلا لمن أعطى موافقته.
  - ما يزيد عن الحد اليومي ينتظر إلى الغد، وإن انقطع الاتصال تبقى الرسائل «قيد الانتظار» ولا تضيع.
- **الردود:** كل رسالة فردية واردة من رقم موجود في الـ CRM تُسجَّل في سجل جهة الاتصال. رسائل الأرقام الأخرى (المحادثات الشخصية) لا تُحفظ.
- **الدردشات:** أيقونة «Discussions / الدردشات» (تظهر في هذا الوضع فقط، مع عدد المحادثات غير المقروءة):
  - تعرض المحادثات الفردية للرقم المربوط (دون المجموعات)، وتتيح قراءتها والرد عليها من الـ CRM.
  - تُقرأ مباشرة من WhatsApp Web عند فتح الصفحة، ولا تُخزَّن في قاعدة البيانات.
  - الرقم الموجود في الـ CRM يظهر بشارة حالته مع رابط إلى ملفه، ويُسجَّل الرد في سجله. لغير الموجود زر «إضافة كجهة اتصال» بالرقم معبّأً.
  - الرد فوري، لا ينتظر دوره ولا الفاصل بين الرسائل، لكنه يُحسب ضمن «أُرسل اليوم». يُرفض الرد فقط إذا بلغ المجموع ضعف الحد اليومي.
- **الجلسة:** محفوظة في volume اسمه `wa_session`. من يملكه يملك الوصول إلى الحساب، فعامله ككلمة مرور.
- **التحديثات:** إن غيّر واتساب واجهته وتعطّل الربط، حدّث `whatsapp-web.js` في `whatsapp-gateway/package.json` ثم أعد البناء.
- **مطابقة إصدار Chromium:** الخادم يعمل بمعالج ARM64، فتستعمل الخدمة Chromium من Debian (لا يوجد Chrome for Testing لـ ARM). يجب أن يطابق إصدار Puppeteer (في `overrides` ضمن `whatsapp-gateway/package.json`) إصدارَ Chromium، وإلا يتوقف الربط بعد المصادقة بخطأ `Page.addScriptToEvaluateOnNewDocument: Target closed`. حاليًا: Chromium 155 مع Puppeteer 25.14.0. إذا أعدت البناء وتغيّر إصدار Chromium (`docker compose exec whatsapp chromium --version`)، اختر إصدار Puppeteer المبني لنفس رقم Chrome.
- **التشخيص:** `docker compose logs whatsapp` يعرض مراحل الإرسال وأخطاءها.

### الربط بـ WhatsApp Business Cloud API

1. أنشئ تطبيقًا في Meta for Developers وفعّل **WhatsApp Business Cloud API**، ثم احصل على *Phone number ID* و*access token* دائم.
2. الرسائل الموجّهة لشخص لم يراسلكم خلال آخر 24 ساعة يجب أن تستعمل **قالبًا مُعتمدًا**. أنشئ قالبًا بمتغيّر واحد `{{1}}` محاط بنص ثابت، مثلًا: `Centre Focus : {{1}} Pour toute question, répondez à ce message.` يضع التطبيق في `{{1}}` النص الكامل للرسالة المخصّصة (وتُحوَّل فواصل الأسطر إلى مسافات لأن Meta يرفضها داخل المتغيّرات). Meta يرفض قالبًا نصّه `{{1}}` فقط أو يبدأ/ينتهي بمتغيّر. للرسائل الترويجية الجماعية اختر فئة Marketing، وللتذكيرات فئة Utility.
3. في `.env`:

```env
MESSAGING_BACKEND=whatsapp_cloud
WHATSAPP_TOKEN=…
WHATSAPP_PHONE_NUMBER_ID=…
WHATSAPP_TEMPLATE_NAME=rappel_focus
WHATSAPP_TEMPLATE_LANG=fr
```

**الإرسال اليدوي:** في قائمة جهات الاتصال، حدّد جهة أو عدة جهات بخانات الاختيار، أو حدّد الصفحة كاملة ثم «تحديد كل جهات الاتصال المطابقة» لتشمل كل نتائج البحث/التصفية الحالية، ثم «إرسال رسالة واتساب». تُخصَّص الرسالة لكل مستلم (`{first_name}`، `{full_name}`) مع معاينة فورية وتأكيد قبل الإرسال لعدة أشخاص، ثم تظهر حالة كل رسالة (مرسَل/قيد الانتظار/فاشل) مع وقتها. يمكن أيضًا مراسلة شخص واحد من صفحته عبر «إرسال رسالة». الحد الأقصى في الإرسال الواحد `MAX_BULK_RECIPIENTS` (500 افتراضيًا)، ويفحص الـ worker قائمة الانتظار كل ثانيتين (`WORKER_INTERVAL_SECONDS`).

لا تُرسل أي رسالة (يدوية أو تذكير أو أتمتة) إلا لجهات الاتصال التي فعّلت خانة **الموافقة**؛ الباقون يظهرون «بدون موافقة» ولا يمكن تحديدهم. الرسائل الفاشلة تظهر في لوحة الحالة مع سبب الخطأ وزر «إعادة المحاولة».

## 5. المساعدة بالذكاء الاصطناعي (اختياري)

ضع مفتاح Anthropic في `ANTHROPIC_API_KEY` لتفعيل «إنشاء بالذكاء الاصطناعي» في تقويم المحتوى. النموذج الافتراضي `claude-opus-5-5` (قابل للتغيير عبر `ANTHROPIC_MODEL`). يولّد الخادم عنوانًا ونصًّا ووسومًا بصيغة JSON منظّمة باللغة والأسلوب المختارين، وتبقى المسودة قابلة للتعديل قبل الحفظ. بدون مفتاح يبقى الزر ظاهرًا ويعرض رسالة توضح أن الميزة غير مفعّلة.

---

## 6. نماذج البيانات

| النموذج | الدور |
| --- | --- |
| `Contact` | الاسم، الهاتف (يُخزَّن ‎+212XXXXXXXXX ويُعرض ‎+212 6XX XXXXXX)، المدينة، المادة، المستوى، الحالة (6 حالات)، المصدر (إعلان/واتساب/ورقي/بيانات قديمة)، الموافقة وتاريخها، الوسوم، تاريخ التسجيل |
| `Appointment` | موعد مرتبط بجهة اتصال: التاريخ، الموضوع، المدة، الحالة (مبرمج/حضر/تغيّب/ملغى)، آخر تذكير مُرسل |
| `InteractionLog` | كل عناصر السجل الزمني: رسائل واتساب (مع حالة التسليم وأوقاتها)، المواعيد، الملاحظات، تغيّرات الحالة. رسائل واتساب الصادرة هي نفسها قائمة الانتظار التي يعالجها الـ worker |
| `FollowUpRule` | قاعدة «إذا [شرط] ثم [إجراء] بعد [تأخير]» مع تفعيل/تعطيل وإحصاءات التنفيذ |
| `ContentPost` | منشور فيسبوك/إنستغرام: نص/صورة/فيديو، الحالة (مسودة/مبرمج/منشور)، تاريخ النشر، توليد بالذكاء الاصطناعي |
| `FollowUpExecution` | يضمن تنفيذ كل قاعدة مرة واحدة فقط لكل حدث |
| `AppSettings` | سطر وحيد: الإيقاف المؤقت للأتمتة، نص التذكير الافتراضي، لغة التواريخ في الرسائل |

**أمان الأتمتة:** لا تُطبَّق القاعدة إلا على الأحداث التي تقع **بعد** تفعيلها؛ تفعيل قاعدة جديدة أو استيراد بيانات قديمة لا يرسل رسائل جماعية لكل القاعدة. «إيقاف الكل مؤقتًا» يوقف كل التنفيذ، وعند الاستئناف تُعالج الأحداث التي استحقت خلال فترة الإيقاف.

**الأرقام الخاضعة لقاعدة معيّنة:** في نافذة تعديل القاعدة (أو إنشائها) خطوة **«Pour»**:
- تعرض كل الأرقام، وفي أعلاها من برمجت لهم القاعدة إجراءً، مع موعده.
- الرقم المؤشَّر تطبَّق عليه القاعدة. أزل العلامة لتستثنيه منها وحدها، وتبقى القواعد الأخرى سارية عليه.
- يُحفظ الاستثناء مع القاعدة، وتُلغى رسائلها التي كانت تنتظر الإرسال لهذه الأرقام.
- عدد الأرقام المستثناة يظهر في بطاقة القاعدة.

**الأرقام الخاضعة للأتمتة:** أسفل القواعد في صفحة الأتمتة قسم «Contacts concernés»:
- **«À venir»:** كل رقم ستطبَّق عليه قاعدة مفعّلة قريبًا، مع اسم القاعدة وموعدها، والبحث بالاسم أو الرقم.
- **زر «Exclure de tout»:** يستثني الرقم من **كل** القواعد، ويُلغي رسائله الآلية التي ما زالت في الانتظار. الرسائل اليدوية والتذكيرات تبقى ممكنة.
- **«Exclus»:** قائمة المستثنين، مع «Réintégrer» للإرجاع، وبحث لاستثناء أي جهة اتصال أخرى مسبقًا.
- **في ملف جهة الاتصال:** يمكن أيضًا الاستثناء والإرجاع من سطر «Automatisations».
- **بعد الإرجاع:** ما استحق أثناء الاستثناء لا يُعوَّض.

### واجهة البرمجة (كلها تحت `/api/`)

| المسار | الوصف |
| --- | --- |
| `auth/csrf/` · `auth/login/` · `auth/logout/` · `auth/me/` | الجلسة |
| `contacts/` · `contacts/{id}/` | CRUD مع `search` و`status` و`source` و`phone` و`ordering` و`page` |
| `contacts/stats/` · `contacts/{id}/timeline/` · `contacts/{id}/notes/` | العدّادات، السجل الزمني، إضافة ملاحظة |
| `appointments/` | CRUD مع `contact` و`upcoming` و`start`/`end` |
| `reminders/preview/` · `reminders/send/` | معاينة الرسائل وإرسالها دفعة واحدة |
| `messages/preview/` · `messages/send/` | الإرسال اليدوي: `contact_ids` أو `filters` (كل المطابقين) + `body` |
| `messages/` · `messages/batches/{uuid}/` · `messages/{id}/retry/` | حالة الإرسال وإعادة المحاولة |
| `whatsapp/status/` · `whatsapp/logout/` | حالة ربط واتساب (ورمز QR) وفكّ الربط |
| `whatsapp/chats/` · `whatsapp/chats/{id}/messages/` · `whatsapp/chats/{id}/reply/` | الدردشات: القائمة، رسائل محادثة، والرد (`body`) |
| `automations/rules/` · `settings/` | القواعد (مع `excluded_contacts`: الأرقام المستثناة من القاعدة) والإيقاف المؤقت ونص التذكير |
| `automations/rules/contacts/?rule={id}` | كل جهات الاتصال لقائمة «Pour» في نافذة القاعدة، مع موعد ما برمجته القاعدة لكل منها |
| `automations/audience/` · `automations/exclusions/` | الأرقام الخاضعة للأتمتة (القادمة والمستثناة)، والاستثناء أو الإرجاع (`contact_ids` + `excluded`) |
| `content/posts/` · `content/posts/generate/` | المنشورات (`month=2026-10` للتقويم) والتوليد بالذكاء الاصطناعي |
| `health/` | فحص الصحة |

---

## 7. نظام التصميم

كل القيم في `frontend/src/styles/tokens.css`:

- **الألوان:** سطح محايد بخمس درجات + لون تمييز واحد `#0f6e6a` (و`#3fb3ac` في الوضع الداكن). ست حالات بألوان مميزة: جديد (أزرق)، مهتم (بنفسجي)، موعد محدد (كهرماني)، حضر (أخضر)، لا رد (رمادي)، مسجَّل (تركواز). كل لون معرّف للوضعين الفاتح والداكن.
- **الخط:** IBM Plex Sans Arabic (عائلة واحدة للاتينية والعربية، مستضافة محليًا بدون CDN).
- **السلّم الطباعي:** 12 / 13 / 14 (النص) / 16 / 18 / 22 / 26 بكسل، مع ارتفاع أسطر أكبر تلقائيًا للعربية.
- **المسافات:** شبكة 4 بكسل (`--space-1` … `--space-12`).
- **التخطيط:** شريط جانبي 240 بكسل / 64 بكسل مطوي (يُطوى تلقائيًا على الشاشات الأصغر من 1400 بكسل ما لم يختر المستخدم غير ذلك). على الهاتف: شريط تبويب سفلي + قائمة جانبية (هامبرغر) للغة والمظهر والحساب.
- **RTL:** خصائص CSS منطقية فقط (`margin-inline-start`، `inset-inline-end`…)؛ الاستثناءات الوحيدة هي `background-position` و`transform` (لا مقابل منطقي لهما) ولها قواعد `[dir='rtl']` صريحة. الأيقونات الاتجاهية تنعكس بالصنف `flip-rtl`، والأرقام الهاتفية تبقى من اليسار إلى اليمين داخل النص العربي، والنصوص التي يكتبها المستخدم تستعمل `dir="auto"`.

---

## 8. ملاحظة حول التوقيت

يستعمل الخادم `Africa/Casablanca`. حسب قاعدة بيانات المناطق الزمنية الحالية (tzdata 2026c) عاد المغرب إلى UTC+0 ابتداءً من 20 سبتمبر 2026. صورة Docker تثبّت tzdata حديثة، لكن المتصفحات أو الأنظمة غير المحدّثة قد تعرض الأوقات بفارق ساعة. إذا لاحظت ذلك، حدّث المتصفح/النظام. نص رسائل التذكير يُنشأ دائمًا على الخادم بالتوقيت الصحيح.
