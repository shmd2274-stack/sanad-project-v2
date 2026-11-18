import { normalizeArabic } from '../text/arabic';

/**
 * Bilingual skills taxonomy. `name` is how the skill is shown in the UI; aliases are matched
 * (after Arabic normalisation) in CV text, job posts and employer edits so that
 * "اكسل", "Microsoft Excel" and "Excel" all count as the same skill.
 */
export interface SkillEntry {
  name: string;
  aliases: string[];
  group: string;
  /** Broader skills this one proves («Flutter» → mobile development); used when matching jobs. */
  implies?: string[];
}

export const SKILLS: SkillEntry[] = [
  // Data & analytics
  { name: 'Excel', aliases: ['excel', 'microsoft excel', 'ms excel', 'اكسل', 'إكسل', 'الاكسل', 'جداول البيانات', 'spreadsheets'], group: 'data' },
  { name: 'SQL', aliases: ['sql', 'mysql', 'postgresql', 'postgres', 'sql server', 'oracle sql', 'قواعد البيانات', 'استعلامات sql'], group: 'data' },
  { name: 'تحليل البيانات', aliases: ['data analysis', 'data analytics', 'analytics', 'تحليل البيانات', 'تحليل بيانات', 'محلل بيانات', 'data analyst'], group: 'data' },
  { name: 'Power BI', aliases: ['power bi', 'powerbi', 'باور بي اي'], group: 'data' },
  { name: 'Tableau', aliases: ['tableau', 'تابلو'], group: 'data' },
  { name: 'Python', aliases: ['python', 'بايثون', 'pandas', 'numpy'], group: 'data' },
  { name: 'R', aliases: ['r programming', 'r language', 'rstudio'], group: 'data' },
  { name: 'الإحصاء', aliases: ['statistics', 'statistical analysis', 'احصاء', 'الاحصاء', 'تحليل احصائي'], group: 'data' },
  { name: 'إعداد التقارير', aliases: ['reporting', 'reports', 'report writing', 'اعداد التقارير', 'كتابة التقارير', 'تقارير'], group: 'data' },
  { name: 'تعلم الآلة', aliases: ['machine learning', 'ml', 'تعلم الاله', 'supervised learning', 'unsupervised learning', 'classification model', 'regression models', 'predictive modeling', 'predictive modelling', 'xgboost', 'random forest', 'النماذج التنبؤيه'], group: 'ai' },
  { name: 'إدخال البيانات', aliases: ['data entry', 'ادخال البيانات', 'ادخال بيانات', 'مدخل بيانات'], group: 'admin' },
  // Software
  { name: 'JavaScript', aliases: ['javascript', 'js', 'جافاسكربت', 'جافا سكربت', 'typescript', 'ts'], group: 'software' },
  { name: 'React', aliases: ['react', 'reactjs', 'react.js', 'رياكت', 'next.js', 'nextjs'], group: 'software' },
  { name: 'HTML/CSS', aliases: ['html', 'css', 'html5', 'css3', 'tailwind', 'bootstrap'], group: 'software' },
  { name: 'Node.js', aliases: ['node', 'node.js', 'nodejs', 'express'], group: 'software' },
  { name: 'Java', aliases: ['java', 'جافا', 'spring', 'spring boot'], group: 'software' },
  { name: 'C#/.NET', aliases: ['c#', '.net', 'dotnet', 'asp.net'], group: 'software' },
  { name: 'تطوير الويب', aliases: ['web development', 'web developer', 'تطوير الويب', 'تطوير المواقع', 'مطور ويب', 'برمجة المواقع', 'frontend', 'front-end', 'backend', 'back-end', 'full stack', 'fullstack'], group: 'software' },
  { name: 'تطوير تطبيقات الجوال', aliases: ['mobile development', 'mobile app development', 'mobile applications', 'mobile application', 'android development', 'ios development', 'android', 'ios', 'تطبيقات الجوال', 'تطوير التطبيقات', 'تطبيق جوال'], group: 'software' },
  { name: 'Git', aliases: ['git', 'github', 'gitlab'], group: 'software' },
  { name: 'اختبار البرمجيات', aliases: ['software testing', 'qa', 'quality assurance testing', 'اختبار البرمجيات', 'فحص الجودة البرمجية'], group: 'software' },
  { name: 'الأمن السيبراني', aliases: ['cybersecurity', 'cyber security', 'information security', 'infosec', 'الامن السيبراني', 'امن المعلومات', 'امن سيبراني', 'security+', 'comptia security', 'cissp', 'cybersecurity professional'], group: 'security' },
  { name: 'الدعم الفني', aliases: ['it support', 'technical support', 'helpdesk', 'help desk', 'الدعم الفني', 'دعم فني', 'الدعم التقني'], group: 'software' },
  { name: 'الشبكات', aliases: ['networking', 'networks', 'ccna', 'الشبكات', 'شبكات الحاسب'], group: 'software' },
  { name: 'الحوسبة السحابية', aliases: ['cloud', 'aws', 'azure', 'google cloud', 'gcp', 'الحوسبة السحابية'], group: 'software' },
  // Design
  { name: 'Figma', aliases: ['figma', 'فيجما', 'فيقما'], group: 'design' },
  { name: 'Adobe Photoshop', aliases: ['photoshop', 'adobe photoshop', 'فوتوشوب'], group: 'design' },
  { name: 'Adobe Illustrator', aliases: ['illustrator', 'adobe illustrator', 'اليستريتور'], group: 'design' },
  { name: 'التصميم', aliases: ['graphic design', 'graphic designer', 'visual design', 'التصميم الجرافيكي', 'مصمم جرافيك', 'تصميم جرافيك', 'canva', 'كانفا'], group: 'design' },
  { name: 'تصميم تجربة المستخدم', aliases: ['ux', 'ui', 'ui/ux', 'ux/ui', 'user experience', 'user interface', 'تجربة المستخدم', 'واجهات المستخدم', 'تصميم الواجهات', 'product design'], group: 'design' },
  { name: 'بحث المستخدم', aliases: ['user research', 'usability testing', 'بحث المستخدم', 'ابحاث المستخدمين', 'اختبار قابلية الاستخدام'], group: 'design' },
  { name: 'المونتاج', aliases: ['video editing', 'premiere', 'after effects', 'final cut', 'مونتاج', 'تحرير الفيديو', 'المونتاج'], group: 'design' },
  { name: 'التصوير', aliases: ['photography', 'تصوير', 'التصوير الفوتوغرافي', 'مصور'], group: 'design' },
  { name: 'الرسم والتصميم ثلاثي الأبعاد', aliases: ['3d', '3d modeling', 'blender', '3ds max', 'maya', 'cinema 4d', 'التصميم ثلاثي الابعاد'], group: 'design' },
  { name: 'الرسم الهندسي (CAD)', aliases: ['cad', 'autocad', 'اوتوكاد', 'revit', 'civil 3d', 'microstation', 'drafting', 'رسم هندسي', 'الرسم الهندسي'], group: 'engineering' },
  // Office & admin
  { name: 'Microsoft Office', aliases: ['microsoft office', 'ms office', 'office', 'مايكروسوفت اوفيس', 'برامج الاوفيس', 'الاوفيس'], group: 'admin' },
  { name: 'Word', aliases: ['word', 'microsoft word', 'وورد', 'الوورد'], group: 'admin' },
  { name: 'PowerPoint', aliases: ['powerpoint', 'power point', 'باوربوينت', 'العروض التقديمية', 'presentations'], group: 'admin' },
  { name: 'الأعمال الإدارية', aliases: ['administration', 'administrative', 'office administration', 'الاعمال الاداريه', 'اعمال اداريه', 'سكرتاريه', 'سكرتير', 'secretary', 'admin assistant', 'مساعد اداري'], group: 'admin' },
  { name: 'الأرشفة وإدارة الوثائق', aliases: ['archiving', 'document management', 'filing', 'الارشفه', 'ارشفه', 'حفظ الملفات', 'ادارة الوثائق'], group: 'admin' },
  { name: 'إدارة المشاريع', aliases: ['project management', 'pmp', 'capm', 'prince2', 'project planning', 'project coordination', 'ادارة المشاريع', 'ادارة المشروعات', 'مدير مشروع', 'project manager', 'trello', 'ms project'], group: 'admin' },
  { name: 'تنظيم الوقت', aliases: ['time management', 'تنظيم الوقت', 'ادارة الوقت'], group: 'soft' },
  { name: 'ERP', aliases: ['erp', 'sap', 'oracle erp', 'odoo', 'اودو', 'انظمة تخطيط الموارد'], group: 'admin' },
  // Customer service, sales, marketing
  { name: 'خدمة العملاء', aliases: ['customer service', 'customer support', 'customer care', 'خدمة العملاء', 'خدمه العملاء', 'دعم العملاء', 'رعاية العملاء', 'call center', 'مركز اتصال'], group: 'service' },
  { name: 'CRM', aliases: ['crm', 'salesforce', 'zendesk', 'hubspot', 'freshdesk', 'ادارة علاقات العملاء'], group: 'service' },
  { name: 'التواصل الكتابي', aliases: ['written communication', 'writing', 'التواصل الكتابي', 'الكتابه', 'كتابة المحتوى', 'content writing', 'copywriting', 'chat support', 'الدعم عبر المحادثه', 'البريد الالكتروني', 'email support'], group: 'soft' },
  // Not "المبيعات" alone: "تحليل المبيعات" (sales analysis) is a data skill, not selling.
  { name: 'البيع والمبيعات', aliases: ['selling', 'sales representative', 'sales executive', 'مندوب مبيعات', 'مندوبه مبيعات', 'موظف مبيعات', 'البيع المباشر', 'مهارات البيع'], group: 'service' },
  { name: 'التسويق الرقمي', aliases: ['digital marketing', 'marketing', 'social media', 'seo', 'التسويق', 'التسويق الرقمي', 'التسويق الالكتروني', 'وسائل التواصل الاجتماعي', 'سوشال ميديا', 'ادارة الحسابات'], group: 'service' },
  { name: 'التجارة الإلكترونية', aliases: ['e-commerce', 'ecommerce', 'shopify', 'salla', 'سلة', 'زد', 'التجاره الالكترونيه', 'متجر الكتروني'], group: 'service' },
  { name: 'الكاشير ونقاط البيع', aliases: ['cashier', 'pos', 'point of sale', 'كاشير', 'امين صندوق', 'نقاط البيع'], group: 'service' },
  // Finance & HR
  { name: 'المحاسبة', aliases: ['accounting', 'accountant', 'bookkeeping', 'المحاسبه', 'محاسبه', 'محاسب', 'مسك الدفاتر', 'قيود محاسبيه'], group: 'finance' },
  { name: 'الأنظمة المحاسبية', aliases: ['quickbooks', 'qoyod', 'قيود', 'دفترة', 'zoho books', 'xero', 'البرامج المحاسبيه'], group: 'finance' },
  { name: 'الموارد البشرية', aliases: ['human resources', 'hr', 'recruitment', 'payroll', 'الموارد البشريه', 'التوظيف', 'شؤون الموظفين', 'الرواتب'], group: 'hr' },
  { name: 'التدقيق', aliases: ['audit', 'auditing', 'التدقيق', 'المراجعه الداخليه', 'تدقيق'], group: 'finance' },
  { name: 'المشتريات', aliases: ['procurement', 'purchasing', 'المشتريات', 'مشتريات'], group: 'finance' },
  // Operations & technical trades
  { name: 'إدارة المخازن', aliases: ['warehouse', 'inventory', 'stock control', 'المخازن', 'المستودعات', 'ادارة المخزون', 'امين مستودع', 'جرد'], group: 'operations' },
  { name: 'الخدمات اللوجستية', aliases: ['logistics', 'supply chain', 'shipping', 'اللوجستيه', 'سلاسل الامداد', 'الشحن'], group: 'operations' },
  { name: 'مراقبة الجودة', aliases: ['quality control', 'quality assurance', 'qc', 'مراقبة الجوده', 'ضبط الجوده', 'الجوده'], group: 'operations' },
  { name: 'الصيانة', aliases: ['maintenance', 'الصيانه', 'صيانه', 'فني صيانه', 'technician'], group: 'operations' },
  { name: 'الكهرباء', aliases: ['electrical', 'electrician', 'الكهرباء', 'كهربائي', 'تمديدات كهربائيه'], group: 'operations' },
  { name: 'التصنيع والإنتاج', aliases: ['manufacturing', 'production line', 'production planning', 'manufacturing operations', 'التصنيع', 'الانتاج', 'خط الانتاج', 'مشغل الات'], group: 'operations' },
  { name: 'السلامة المهنية', aliases: ['occupational safety', 'hse', 'health and safety', 'السلامه المهنيه', 'الامن والسلامه'], group: 'operations' },
  { name: 'الطبخ وإعداد الطعام', aliases: ['cooking', 'chef', 'culinary', 'food preparation', 'الطبخ', 'طباخ', 'اعداد الطعام', 'المطاعم'], group: 'operations' },
  { name: 'الخياطة والتطريز', aliases: ['tailoring', 'sewing', 'embroidery', 'الخياطه', 'خياط', 'التطريز'], group: 'operations' },
  { name: 'النجارة', aliases: ['carpentry', 'woodwork', 'النجاره', 'نجار'], group: 'operations' },
  // Health & education
  { name: 'الرعاية الصحية', aliases: ['healthcare', 'nursing', 'nurse', 'التمريض', 'ممرض', 'الرعايه الصحيه'], group: 'health' },
  { name: 'المختبرات الطبية', aliases: ['laboratory', 'lab technician', 'المختبرات', 'فني مختبر', 'التحاليل الطبيه'], group: 'health' },
  // Not "التعليم"/"التدريب" alone: those are CV section headings ("Education", "Training").
  { name: 'التعليم والتدريب', aliases: ['teaching', 'teacher', 'trainer', 'التدريس', 'معلم', 'معلمه', 'مدرب', 'مدربه'], group: 'education' },
  // Communication & languages
  { name: 'لغة الإشارة السعودية', aliases: ['saudi sign language', 'sign language', 'لغة الاشاره', 'لغة الاشاره السعوديه', 'الاشاره'], group: 'language' },
  { name: 'اللغة الإنجليزية', aliases: ['english', 'english language', 'اللغه الانجليزيه', 'الانجليزيه', 'انجليزي', 'ielts', 'toefl', 'step'], group: 'language' },
  { name: 'اللغة العربية', aliases: ['arabic', 'arabic language', 'اللغه العربيه', 'العربيه'], group: 'language' },
  { name: 'الترجمة', aliases: ['translation', 'translator', 'الترجمه', 'مترجم'], group: 'language' },
  // Soft skills
  { name: 'حل المشكلات', aliases: ['problem solving', 'problem-solving', 'حل المشكلات', 'حل المشاكل'], group: 'soft' },
  { name: 'العمل الجماعي', aliases: ['teamwork', 'team work', 'collaboration', 'العمل الجماعي', 'العمل ضمن فريق', 'روح الفريق', 'التعاون'], group: 'soft' },
  { name: 'القيادة', aliases: ['leadership', 'team lead', 'القياده', 'قائد فريق', 'اداره فريق'], group: 'soft' },
  { name: 'التفكير النقدي', aliases: ['critical thinking', 'analytical thinking', 'التفكير النقدي', 'التفكير التحليلي'], group: 'soft' },
  { name: 'الدقة والاهتمام بالتفاصيل', aliases: ['attention to detail', 'detail oriented', 'detail-oriented', 'الدقه', 'الاهتمام بالتفاصيل', 'دقة في العمل'], group: 'soft' },
  { name: 'تنظيم الأفكار', aliases: ['organizing ideas', 'تنظيم الافكار', 'mind mapping'], group: 'soft' },
  { name: 'التعلم الذاتي', aliases: ['self-learning', 'self learning', 'fast learner', 'التعلم الذاتي', 'سرعة التعلم'], group: 'soft' },
  { name: 'العرض والتقديم', aliases: ['presentation skills', 'presentations', 'presentation', 'public presentation', 'public speaking', 'مهارات العرض', 'العرض والتقديم', 'الالقاء'], group: 'soft' },
  { name: 'التفاوض', aliases: ['negotiation', 'التفاوض', 'مهارات التفاوض'], group: 'soft' },
  { name: 'إدارة الضغوط', aliases: ['stress management', 'working under pressure', 'العمل تحت الضغط', 'تحمل ضغط العمل'], group: 'soft' },
  { name: 'خدمة الآخرين والتعاطف', aliases: ['empathy', 'التعاطف', 'الاصغاء', 'active listening'], group: 'soft' },
  { name: 'المرونة والتكيف', aliases: ['adaptability', 'flexibility', 'المرونه', 'التكيف', 'سرعة التكيف'], group: 'soft' },
  { name: 'اتخاذ القرار', aliases: ['decision making', 'decision-making', 'اتخاذ القرار', 'اتخاذ القرارات'], group: 'soft' },
  { name: 'الإبداع', aliases: ['creativity', 'creative thinking', 'الابداع', 'التفكير الابداعي'], group: 'soft' },
  // Data & IT (more)
  { name: 'ETL وتكامل البيانات', aliases: ['etl', 'data integration', 'data pipelines', 'ssis', 'informatica', 'تكامل البيانات'], group: 'data' },
  { name: 'التمثيل المرئي للبيانات', aliases: ['data visualization', 'data visualisation', 'dashboards', 'dashboard', 'لوحات المعلومات', 'لوحات البيانات', 'تصوير البيانات', 'التمثيل المرئي للبيانات', 'visual reports'], group: 'data' },
  { name: 'Power Query وDAX', aliases: ['power query', 'dax', 'power pivot'], group: 'data' },
  { name: 'البيانات الضخمة', aliases: ['big data', 'hadoop', 'spark', 'pyspark', 'البيانات الضخمه'], group: 'data' },
  { name: 'Linux', aliases: ['linux', 'ubuntu', 'red hat', 'centos', 'bash scripting', 'لينكس'], group: 'software' },
  { name: 'Windows Server وActive Directory', aliases: ['windows server', 'active directory', 'group policy', 'office 365 admin', 'microsoft 365 admin'], group: 'software' },
  { name: 'DevOps', aliases: ['devops', 'docker', 'kubernetes', 'ci/cd', 'jenkins', 'terraform', 'ansible'], group: 'software' },
  { name: 'PHP', aliases: ['php', 'laravel', 'wordpress', 'ووردبريس'], group: 'software' },
  { name: 'Python للويب', aliases: ['django', 'flask', 'fastapi'], group: 'software' },
  { name: 'ITIL وإدارة خدمات التقنية', aliases: ['itil', 'it service management', 'servicenow', 'comptia', 'a+'], group: 'software' },
  { name: 'إمكانية الوصول الرقمي', aliases: ['accessibility', 'wcag', 'a11y', 'امكانية الوصول', 'الوصول الشامل'], group: 'design' },
  // Design & media (more)
  { name: 'Adobe XD وSketch', aliases: ['adobe xd', 'xd', 'sketch', 'invision', 'zeplin'], group: 'design' },
  { name: 'Adobe InDesign', aliases: ['indesign', 'adobe indesign', 'انديزاين'], group: 'design' },
  { name: 'الموشن جرافيك', aliases: ['motion graphics', 'animation', 'after effects', 'موشن جرافيك', 'الرسوم المتحركه'], group: 'design' },
  { name: 'الهوية البصرية', aliases: ['branding', 'brand identity', 'visual identity', 'الهويه البصريه', 'تصميم الشعارات', 'logo design'], group: 'design' },
  { name: 'صناعة المحتوى', aliases: ['content creation', 'content creator', 'صناعة المحتوي', 'صانع محتوي', 'كتابة المحتوي الابداعي'], group: 'media' },
  { name: 'التدقيق اللغوي والتحرير', aliases: ['proofreading', 'copy editing', 'copyediting', 'التدقيق اللغوي', 'التحرير الصحفي', 'تحرير النصوص'], group: 'media' },
  { name: 'الإعلانات الرقمية', aliases: ['google ads', 'meta ads', 'facebook ads', 'snapchat ads', 'tiktok ads', 'ppc', 'الاعلانات الممولة', 'الحملات الاعلانية'], group: 'service' },
  { name: 'تحسين محركات البحث', aliases: ['seo', 'sem', 'search engine optimization', 'تحسين محركات البحث'], group: 'service' },
  { name: 'أبحاث السوق', aliases: ['market research', 'ابحاث السوق', 'دراسة السوق', 'دراسات الجدوي', 'feasibility study'], group: 'service' },
  // Engineering
  { name: 'الهندسة المدنية', aliases: ['civil engineering', 'structural engineering', 'الهندسه المدنيه', 'مهندس مدني', 'الانشاءات', 'construction'], group: 'engineering' },
  { name: 'الهندسة الميكانيكية', aliases: ['mechanical engineering', 'الهندسه الميكانيكيه', 'مهندس ميكانيكي', 'solidworks', 'catia'], group: 'engineering' },
  { name: 'الهندسة الكهربائية', aliases: ['electrical engineering', 'power systems', 'الهندسه الكهربائيه', 'مهندس كهربائي'], group: 'engineering' },
  { name: 'الهندسة الصناعية', aliases: ['industrial engineering', 'الهندسه الصناعيه', 'مهندس صناعي'], group: 'engineering' },
  { name: 'MATLAB', aliases: ['matlab', 'simulink', 'ماتلاب'], group: 'engineering' },
  { name: 'PLC وأنظمة التحكم', aliases: ['plc', 'scada', 'automation', 'control systems', 'انظمة التحكم', 'الاتمته'], group: 'engineering' },
  { name: 'التكييف والتبريد', aliases: ['hvac', 'air conditioning', 'refrigeration', 'التكييف', 'التبريد', 'فني تكييف'], group: 'crafts' },
  { name: 'إدارة المرافق', aliases: ['facility management', 'facilities management', 'ادارة المرافق'], group: 'operations' },
  { name: 'نظم المعلومات الجغرافية', aliases: ['gis', 'arcgis', 'qgis', 'نظم المعلومات الجغرافيه'], group: 'engineering' },
  // Health
  { name: 'رعاية المرضى', aliases: ['patient care', 'رعاية المرضي', 'العنايه بالمرضي', 'nursing care'], group: 'health' },
  { name: 'الإسعافات الأولية والإنعاش', aliases: ['first aid', 'cpr', 'bls', 'acls', 'الاسعافات الاوليه', 'الانعاش القلبي'], group: 'health' },
  { name: 'السجلات الطبية والترميز', aliases: ['medical records', 'medical coding', 'icd-10', 'icd10', 'cpt', 'السجلات الطبيه', 'الترميز الطبي', 'hospital information system'], group: 'health' },
  { name: 'الصيدلة', aliases: ['pharmacy', 'pharmacist', 'الصيدله', 'صيدلي', 'صرف الادويه'], group: 'health' },
  { name: 'الأشعة', aliases: ['radiology', 'x-ray', 'radiography', 'الاشعه', 'فني اشعه'], group: 'health' },
  { name: 'العلاج الطبيعي', aliases: ['physiotherapy', 'physical therapy', 'العلاج الطبيعي', 'اخصائي علاج طبيعي'], group: 'health' },
  { name: 'مساعدة طبيب الأسنان', aliases: ['dental assistant', 'dental assisting', 'مساعد طبيب اسنان'], group: 'health' },
  { name: 'التغذية العلاجية', aliases: ['nutrition', 'dietitian', 'clinical nutrition', 'التغذيه', 'اخصائي تغذيه'], group: 'health' },
  { name: 'مكافحة العدوى', aliases: ['infection control', 'مكافحة العدوي'], group: 'health' },
  // Finance & legal & HR (more)
  { name: 'المعايير الدولية IFRS', aliases: ['ifrs', 'gaap', 'المعايير الدوليه', 'socpa'], group: 'finance' },
  { name: 'الزكاة والضريبة', aliases: ['vat', 'zakat', 'tax', 'zatca', 'الزكاه', 'الضريبه', 'ضريبة القيمه المضافه'], group: 'finance' },
  { name: 'التحليل المالي والموازنات', aliases: ['financial analysis', 'budgeting', 'forecasting', 'financial modeling', 'التحليل المالي', 'الموازنات', 'اعداد الميزانيه', 'التخطيط المالي'], group: 'finance' },
  { name: 'الذمم والتحصيل', aliases: ['accounts receivable', 'accounts payable', 'collection', 'الذمم الدائنه', 'الذمم المدينه', 'التحصيل'], group: 'finance' },
  { name: 'الشؤون القانونية', aliases: ['legal', 'contracts', 'contract drafting', 'legal research', 'litigation', 'صياغة العقود', 'العقود', 'الشؤون القانونيه', 'محامي', 'مستشار قانوني'], group: 'legal' },
  { name: 'الامتثال والحوكمة', aliases: ['compliance', 'governance', 'risk management', 'aml', 'الامتثال', 'الحوكمه', 'ادارة المخاطر'], group: 'legal' },
  { name: 'التدريب والتطوير', aliases: ['training and development', 'learning and development', 'l&d', 'تطوير الموظفين', 'تحليل الاحتياجات التدريبيه'], group: 'hr' },
  { name: 'أنظمة الموارد البشرية', aliases: ['hris', 'mudad', 'مدد', 'qiwa', 'قوى', 'gosi', 'التامينات الاجتماعيه', 'مسير الرواتب'], group: 'hr' },
  // Admin & government
  { name: 'المراسلات الإدارية', aliases: ['correspondence', 'business writing', 'المراسلات', 'المراسلات الاداريه', 'الخطابات الرسميه', 'كتابة الخطابات'], group: 'admin' },
  { name: 'الطباعة السريعة', aliases: ['typing', 'fast typing', 'الطباعه السريعه', 'الطباعه علي الحاسب'], group: 'admin' },
  { name: 'Google Workspace', aliases: ['google workspace', 'google sheets', 'google docs', 'g suite', 'google slides'], group: 'admin' },
  { name: 'Outlook وTeams', aliases: ['outlook', 'microsoft teams', 'ms teams', 'sharepoint', 'zoom'], group: 'admin' },
  { name: 'الاستقبال وتنظيم المواعيد', aliases: ['reception', 'receptionist', 'front desk', 'appointment scheduling', 'الاستقبال', 'موظف استقبال', 'تنظيم المواعيد', 'حجز المواعيد'], group: 'admin' },
  // Operations, logistics, quality
  { name: 'التخليص الجمركي', aliases: ['customs clearance', 'التخليص الجمركي', 'مخلص جمركي'], group: 'operations' },
  { name: 'إدارة الأسطول والنقل', aliases: ['fleet management', 'transportation', 'dispatch', 'ادارة الاسطول', 'النقل والتوزيع'], group: 'operations' },
  { name: 'ISO وأنظمة الجودة', aliases: ['iso 9001', 'iso', 'quality management system', 'qms', 'six sigma', 'lean', 'كايزن', 'kaizen', 'الايزو'], group: 'operations' },
  { name: 'السلامة المهنية المعتمدة', aliases: ['nebosh', 'osha', 'iosh'], group: 'operations' },
  { name: 'الجرد ومراقبة المخزون', aliases: ['stocktaking', 'inventory control', 'cycle count', 'الجرد', 'مراقبة المخزون'], group: 'operations' },
  { name: 'العرض المرئي للمنتجات', aliases: ['visual merchandising', 'merchandising', 'تنسيق المعروضات', 'العرض المرئي'], group: 'service' },
  // Hospitality & crafts
  { name: 'الضيافة وخدمة الطعام', aliases: ['hospitality', 'food and beverage', 'f&b', 'waiter', 'الضيافه', 'خدمة الطعام والشراب'], group: 'hospitality' },
  { name: 'الباريستا', aliases: ['barista', 'coffee', 'باريستا', 'تحضير القهوه'], group: 'hospitality' },
  { name: 'التدبير الفندقي', aliases: ['housekeeping', 'التدبير الفندقي', 'خدمة الغرف'], group: 'hospitality' },
  { name: 'السباكة', aliases: ['plumbing', 'السباكه', 'سباك'], group: 'crafts' },
  { name: 'اللحام', aliases: ['welding', 'اللحام', 'لحام'], group: 'crafts' },
  { name: 'ميكانيكا السيارات', aliases: ['auto mechanic', 'automotive', 'car maintenance', 'ميكانيكا السيارات', 'صيانة السيارات', 'ميكانيكي'], group: 'crafts' },
  { name: 'صيانة الجوالات والحاسب', aliases: ['phone repair', 'computer maintenance', 'hardware repair', 'صيانة الجوالات', 'صيانة الحاسب'], group: 'crafts' },
  { name: 'التجميل والعناية', aliases: ['beauty', 'makeup', 'hairdressing', 'nail art', 'المكياج', 'التجميل', 'تصفيف الشعر'], group: 'crafts' },
  { name: 'الزراعة', aliases: ['agriculture', 'farming', 'irrigation', 'الزراعه', 'الري'], group: 'crafts' },
  { name: 'التدريب الرياضي', aliases: ['fitness', 'personal trainer', 'coaching', 'المدرب الشخصي', 'اللياقه البدنيه', 'التدريب الرياضي'], group: 'education' },
  // Education (more)
  { name: 'التربية الخاصة', aliases: ['special education', 'التربيه الخاصه', 'تعليم ذوي الاعاقه', 'صعوبات التعلم'], group: 'education' },
  { name: 'إعداد المناهج', aliases: ['curriculum development', 'instructional design', 'اعداد المناهج', 'التصميم التعليمي'], group: 'education' },
  { name: 'إدارة الصف', aliases: ['classroom management', 'ادارة الصف'], group: 'education' },
  // ───── Added for ATS-style reading of any CV ─────
  // AI
  { name: 'الذكاء الاصطناعي', aliases: ['artificial intelligence', 'ai', 'ai-powered', 'ai-driven', 'ai solutions', 'الذكاء الاصطناعي', 'ذكاء اصطناعي'], group: 'ai' },
  { name: 'الذكاء الاصطناعي التوليدي', aliases: ['generative ai', 'genai', 'gen ai', 'llm', 'llms', 'large language models', 'prompt engineering', 'rag', 'الذكاء الاصطناعي التوليدي', 'النماذج اللغويه الكبيره'], group: 'ai', implies: ['الذكاء الاصطناعي'] },
  { name: 'التعلم العميق', aliases: ['deep learning', 'neural networks', 'التعلم العميق', 'الشبكات العصبيه'], group: 'ai', implies: ['تعلم الآلة'] },
  { name: 'معالجة اللغات الطبيعية', aliases: ['nlp', 'natural language processing', 'text mining', 'speech recognition', 'asr', 'tts', 'text to speech', 'معالجة اللغه الطبيعيه', 'معالجة اللغات الطبيعيه'], group: 'ai', implies: ['الذكاء الاصطناعي'] },
  { name: 'الرؤية الحاسوبية', aliases: ['computer vision', 'image processing', 'opencv', 'yolo', 'object detection', 'الرؤيه الحاسوبيه', 'معالجة الصور'], group: 'ai', implies: ['الذكاء الاصطناعي'] },
  { name: 'Scikit-learn', aliases: ['scikit-learn', 'scikit learn', 'sklearn'], group: 'ai', implies: ['تعلم الآلة', 'Python'] },
  { name: 'TensorFlow', aliases: ['tensorflow', 'keras'], group: 'ai', implies: ['التعلم العميق', 'Python'] },
  { name: 'PyTorch', aliases: ['pytorch', 'torch'], group: 'ai', implies: ['التعلم العميق', 'Python'] },
  { name: 'OpenAI API', aliases: ['openai', 'openai api', 'gpt-4', 'gpt-4o', 'gpt', 'chatgpt'], group: 'ai', implies: ['الذكاء الاصطناعي التوليدي'] },
  { name: 'علم البيانات', aliases: ['data science', 'data scientist', 'علم البيانات', 'عالم بيانات'], group: 'data', implies: ['تحليل البيانات'] },
  { name: 'تنظيف البيانات', aliases: ['data cleaning', 'data cleansing', 'data validation', 'data preparation', 'data wrangling', 'eda', 'exploratory data analysis', 'anomaly detection', 'تنظيف البيانات', 'تجهيز البيانات'], group: 'data', implies: ['تحليل البيانات'] },
  { name: 'مؤشرات الأداء (KPIs)', aliases: ['kpi', 'kpis', 'key performance indicators', 'performance indicators', 'مؤشرات الاداء', 'مؤشرات الأداء الرئيسيه'], group: 'data' },
  { name: 'نمذجة البيانات', aliases: ['data modeling', 'data modelling', 'database design', 'erd', 'نمذجة البيانات', 'تصميم قواعد البيانات'], group: 'data', implies: ['SQL'] },
  { name: 'PL/SQL', aliases: ['pl/sql', 'plsql', 'oracle pl/sql'], group: 'data', implies: ['SQL'] },
  // Cybersecurity
  { name: 'مركز العمليات الأمنية (SOC)', aliases: ['soc', 'soc operations', 'soc analyst', 'security operations', 'security operations center', 'siem', 'splunk', 'qradar', 'مركز العمليات الامنيه'], group: 'security', implies: ['الأمن السيبراني'] },
  { name: 'الحوكمة والمخاطر والامتثال (GRC)', aliases: ['grc', 'governance risk and compliance', 'governance, risk and compliance', 'cyber risk', 'cybersecurity risk', 'information security risk', 'nca ecc', 'iso 27001', 'nist', 'الحوكمه والمخاطر والامتثال'], group: 'security', implies: ['الأمن السيبراني'] },
  { name: 'الاستجابة للحوادث الأمنية', aliases: ['incident response', 'incident handling', 'dfir', 'digital forensics', 'forensics', 'threat hunting', 'الاستجابه للحوادث', 'التحقيق الجنائي الرقمي'], group: 'security', implies: ['الأمن السيبراني'] },
  { name: 'تقييم الثغرات واختبار الاختراق', aliases: ['vulnerability assessment', 'vulnerability assessement', 'vulnerability management', 'vulnerability scanning', 'penetration testing', 'pentesting', 'pen testing', 'ethical hacking', 'nessus', 'burp suite', 'اختبار الاختراق', 'تقييم الثغرات'], group: 'security', implies: ['الأمن السيبراني'] },
  // Software & tools
  { name: 'Flutter', aliases: ['flutter', 'dart'], group: 'software', implies: ['تطوير تطبيقات الجوال'] },
  { name: 'Kotlin', aliases: ['kotlin'], group: 'software', implies: ['تطوير تطبيقات الجوال'] },
  { name: 'Swift', aliases: ['swift', 'swiftui'], group: 'software', implies: ['تطوير تطبيقات الجوال'] },
  { name: 'Firebase', aliases: ['firebase', 'firestore'], group: 'software' },
  { name: 'Agile وScrum', aliases: ['agile', 'scrum', 'kanban', 'jira', 'sdlc', 'software development lifecycle', 'software development life cycle', 'المنهجيه الرشيقه'], group: 'software' },
  { name: 'تصميم الواجهات (UI)', aliases: ['ui design', 'interface design', 'تصميم الواجهات', 'تصميم واجهات المستخدم'], group: 'design', implies: ['تصميم تجربة المستخدم'] },
  { name: 'الروبوتات', aliases: ['robotics', 'robot', 'robots', 'nao robot', 'nao', 'الروبوتات', 'روبوت', 'raspberry pi'], group: 'engineering' },
  { name: 'Arduino', aliases: ['arduino', 'اردوينو'], group: 'engineering', implies: ['الروبوتات'] },
  // Service & operations
  { name: 'جودة الخدمات', aliases: ['service quality', 'quality of service', 'sla', 'slas', 'service level agreements', 'customer experience', 'جوده الخدمات', 'تجربة العميل', 'اتفاقيات مستوى الخدمه'], group: 'service' },
  { name: 'تحسين العمليات', aliases: ['process improvement', 'business process', 'process optimization', 'lean', 'six sigma', 'bpm', 'تحسين العمليات', 'اعادة هندسة الاجراءات', 'تحسين الاجراءات'], group: 'operations' },
  { name: 'التخطيط الاستراتيجي', aliases: ['strategic planning', 'strategy development', 'التخطيط الاستراتيجي', 'الاستراتيجيه'], group: 'admin' },
  { name: 'تنظيم الفعاليات', aliases: ['event management', 'event planning', 'event coordination', 'booth operations', 'تنظيم الفعاليات', 'ادارة الفعاليات'], group: 'service' },
  // Soft skills
  { name: 'المهارات التنظيمية', aliases: ['organizational skills', 'organisational skills', 'organization skills', 'المهارات التنظيميه', 'مهارات تنظيميه'], group: 'soft' },
  { name: 'مهارات التواصل', aliases: ['communication skills', 'effective communication', 'مهارات التواصل', 'مهارات الاتصال', 'التواصل الفعال'], group: 'soft' },
  { name: 'حل النزاعات', aliases: ['conflict resolution', 'conflict management', 'حل النزاعات', 'حل الخلافات'], group: 'soft' },
  { name: 'مهارات التعامل مع الآخرين', aliases: ['interpersonal skills', 'people skills', 'مهارات التعامل مع الاخرين', 'العلاقات الشخصيه'], group: 'soft' },
  { name: 'الإرشاد والتوجيه', aliases: ['mentoring', 'mentorship', 'mentored', 'coaching', 'الارشاد', 'التوجيه', 'الارشاد الاكاديمي'], group: 'soft' },
  { name: 'التوظيف والاستقطاب', aliases: ['recruitment', 'recruiting', 'talent acquisition', 'sourcing candidates', 'التوظيف', 'الاستقطاب', 'استقطاب المواهب'], group: 'hr' },
  { name: 'شؤون الموظفين والرواتب', aliases: ['payroll', 'personnel', 'employee relations', 'onboarding', 'شؤون الموظفين', 'الرواتب', 'مسير الرواتب', 'علاقات الموظفين'], group: 'hr' },
  { name: 'تحليل السبب الجذري', aliases: ['root cause analysis', 'rca', 'fmea', 'تحليل السبب الجذري'], group: 'engineering' },
  { name: 'SolidWorks', aliases: ['solidworks', 'catia', 'inventor'], group: 'engineering', implies: ['الرسم الهندسي (CAD)'] },
  // Licences
  { name: 'رخصة قيادة', aliases: ['driving license', "driver's license", 'رخصة قياده', 'رخصة سياره'], group: 'operations' },
];

interface CompiledSkill { entry: SkillEntry; patterns: string[] }
const compiled: CompiledSkill[] = SKILLS.map(entry => ({
  entry,
  patterns: [...new Set([entry.name, ...entry.aliases].map(normalizeArabic).filter(alias => alias.length >= 2))],
}));

function containsPhrase(haystack: string, phrase: string): boolean {
  // Word-boundary match that works for Arabic and Latin (and tokens like c#, .net, node.js).
  let from = 0;
  while (true) {
    const index = haystack.indexOf(phrase, from);
    if (index === -1) return false;
    const before = haystack[index - 1];
    const after = haystack[index + phrase.length];
    const boundary = (char: string | undefined) => char === undefined || /[\s,،;:()[\]/|\-•·.!?؟]/.test(char);
    // Allow Arabic proclitics glued to a word, also before Latin skills: "وExcel"، "بالـSQL".
    const prefix = haystack.slice(Math.max(0, index - 3), index);
    const prefixed = /(^|\s)(و|ب|ل|ف|ال|وال|بال)$/.test(prefix);
    if ((boundary(before) || prefixed) && boundary(after)) return true;
    from = index + 1;
  }
}

// «data warehouse» is not warehouse management; «in production» is not manufacturing; «we are hiring» is not recruitment.
const AMBIGUOUS = /\b(data|lake|snowflake|bigquery|redshift|cloud|analytics|dwh)\s*\/?\s*warehous\w*|\bwarehous\w* (solutions?|architecture|design|model\w*|tables?|layer)\b|\b(in|into|to|for) production\b|\bproduction[- ](ready|grade|environments?|systems?|deployments?|models?|code|data|issues|support|use)\b|\b(we are|we re|now|currently) hiring\b|\bhiring (managers?|teams?|process)\b/g;
const clean = (normalized: string) => normalized.replace(AMBIGUOUS, ' ');

/** Finds taxonomy skills mentioned in free text (CV, job description). Order: first mention. */
export function findSkills(text: string): string[] {
  const haystack = ` ${clean(normalizeArabic(text))} `;
  const found: { name: string; at: number }[] = [];
  for (const { entry, patterns } of compiled) {
    let first = Infinity;
    for (const pattern of patterns) {
      if (pattern.length <= 2 && !/[a-z]/.test(pattern)) continue;
      if (containsPhrase(haystack, pattern)) first = Math.min(first, haystack.indexOf(pattern));
    }
    if (first !== Infinity) found.push({ name: entry.name, at: first });
  }
  return found.sort((a, b) => a.at - b.at).map(item => item.name);
}

/**
 * Does the text mention this skill under any of its spellings? This is how an ATS scans a CV
 * for a job's keywords. `normalizedText` must come from normalizeArabic().
 */
export function mentionsSkill(normalizedText: string, skill: string): boolean {
  const key = normalizeArabic(skill);
  // A skill name accepts all its spellings; a specific alias («AutoCAD») only itself.
  const entry = compiled.find(item => normalizeArabic(item.entry.name) === key);
  const patterns = entry ? entry.patterns : [key];
  const haystack = ` ${clean(normalizedText)} `;
  return patterns.some(pattern => (pattern.length > 2 || /[a-z]/.test(pattern)) && containsPhrase(haystack, pattern));
}

/** Maps any spelling of a skill to its canonical name; unknown skills are returned trimmed. */
export function canonicalSkill(skill: string): string {
  const key = normalizeArabic(skill);
  for (const { entry, patterns } of compiled) if (patterns.includes(key)) return entry.name;
  return skill.trim();
}

/** Adds the broader skills that listed tools prove, e.g. Flutter → تطوير تطبيقات الجوال (used for matching). */
export function withImpliedSkills(skills: readonly string[]): string[] {
  const out = new Set(skills.map(canonicalSkill));
  const queue = [...out];
  while (queue.length) {
    const entry = SKILLS.find(item => item.name === queue.pop());
    for (const implied of entry?.implies ?? []) if (!out.has(implied)) { out.add(implied); queue.push(implied); }
  }
  return [...out];
}

export function skillGroup(skill: string): string | null {
  const canonical = canonicalSkill(skill);
  return SKILLS.find(entry => entry.name === canonical)?.group ?? null;
}
