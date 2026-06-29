// Centralized, language-aware indicator descriptions.
// Single source of truth: desc/details for EVERY indicator id live here in RU/EN/KZ.
// The modal picks the active language at render time. Indicator *names* stay in
// English by product rule — only the surrounding prose is translated.

type Lang = "RU" | "EN" | "KZ"

export interface LocalizedDescription {
  desc: Record<Lang, string>
  details: Record<Lang, string>
}

export const INDICATOR_DESCRIPTIONS: Record<string, LocalizedDescription> = {
  volume: {
    desc: {
      RU: "Отображает вертикальный объем торгов за каждую свечу в отдельном подвальном окне графиков.",
      EN: "Shows the vertical trading volume for each candle in a separate sub-panel below the chart.",
      KZ: "Әр свеча үшін тік сауда көлемін графиктің астындағы бөлек панельде көрсетеді.",
    },
    details: {
      RU: "Помогает моментально оценить общую торговую активность за таймфрейм. Высокие столбцы объема свидетельствуют об активном участии крупных рыночных игроков, подтверждают истинность пробоев или сигнализируют о замедлении движения у ключевых уровней.",
      EN: "Lets you instantly gauge overall trading activity within a timeframe. Tall volume bars indicate active participation of large market players, confirm the validity of breakouts or signal a slowdown near key levels.",
      KZ: "Таймфрейм ішіндегі жалпы сауда белсенділігін бірден бағалауға мүмкіндік береді. Биік көлем бағандары ірі нарық ойыншыларының белсенді қатысуын білдіреді, бұзылулардың шынайылығын растайды немесе негізгі деңгейлердегі баяулауды сигнал береді.",
    },
  },
  volumeProfile: {
    desc: {
      RU: "Строит горизонтальный профиль объемов (Volume Profile) распределения проторгованных лотов по ценам за выбранный период.",
      EN: "Builds a horizontal Volume Profile of traded lots distributed across prices over the selected period.",
      KZ: "Таңдалған кезеңдегі бағалар бойынша сатылған лоттардың таралуының көлденең Volume Profile-ін құрады.",
    },
    details: {
      RU: "Позволяет выявлять сильные невидимые уровни поддержки и сопротивления. Четко прорисовывает уровень Point of Control (POC) — цену с максимальным скоплением торгов, где сосредоточены крупнейшие лимитные скопления.",
      EN: "Helps reveal strong invisible support and resistance levels. Clearly draws the Point of Control (POC) — the price with the largest concentration of trades, where the biggest limit clusters sit.",
      KZ: "Күшті көрінбейтін қолдау мен қарсылық деңгейлерін анықтауға көмектеседі. Point of Control (POC) деңгейін — ең көп сауда жинақталған, ең ірі лимиттік шоғырлар орналасқан бағаны анық сызады.",
    },
  },
  marketProfile: {
    desc: {
      RU: "Строит классический рыночный профиль на основе времени нахождения цены на каждом уровне (TPO - Time Price Opportunity).",
      EN: "Builds a classic Market Profile based on the time price spends at each level (TPO — Time Price Opportunity).",
      KZ: "Бағаның әр деңгейде болу уақытына негізделген классикалық Market Profile құрады (TPO — Time Price Opportunity).",
    },
    details: {
      RU: "Визуализирует распределение ликвидности по времени. Помогает определить 'справедливую стоимость' (Value Area), выявить зоны баланса и дисбаланса, а также сильные выходы за пределы устоявшихся ценовых зон.",
      EN: "Visualizes the distribution of liquidity over time. Helps determine the 'fair value' (Value Area), identify balance and imbalance zones, and strong moves beyond established price areas.",
      KZ: "Уақыт бойынша өтімділіктің таралуын көрсетеді. 'Әділ құнды' (Value Area) анықтауға, тепе-теңдік пен дисбаланс аймақтарын, сондай-ақ қалыптасқан баға аймақтарынан тыс күшті шығуларды анықтауға көмектеседі.",
    },
  },
  liquidations: {
    desc: {
      RU: "Выделяет на ценовой шкале и свечах зоны принудительного закрытия (ликвидации) ордеров маржинальных трейдеров (Long/Short).",
      EN: "Highlights forced-closure (liquidation) zones of margin traders' orders (Long/Short) on the price scale and candles.",
      KZ: "Маржиналды трейдерлердің ордерлерінің (Long/Short) мәжбүрлі жабылу (ликвидация) аймақтарын баға шкаласы мен свечаларда белгілейді.",
    },
    details: {
      RU: "Ликвидации покупателей отображаются красным цветом, шортистов — зеленым. Крупные ликвидации часто выступают топливом для стремительного движения рынка, а также указывают на появление локальных экстремумов.",
      EN: "Long liquidations are shown in red, short ones in green. Large liquidations often fuel sharp market moves and point to local extremes.",
      KZ: "Сатып алушылардың ликвидациясы қызыл түспен, шорттардікі жасылмен көрсетіледі. Ірі ликвидациялар көбіне нарықтың күрт қозғалысына отын болады және жергілікті экстремумдарды көрсетеді.",
    },
  },
  reversalClusters: {
    desc: {
      RU: "Идентифицирует ситуации с запертым на тенях свечей максимальным объемом (POC).",
      EN: "Identifies situations where the maximum volume (POC) is locked in the candle wicks.",
      KZ: "Максималды көлем (POC) свеча көлеңкелерінде құлыпталған жағдайларды анықтайды.",
    },
    details: {
      RU: "Детектирует разворотную логику: если крупный рыночный объем выходит на самых кончиках теней свечей на экстремумах графика, а цена затем разворачивается в обратную сторону — это доказывает наличие встречного лимитного ордера, забравшего всю энергию движения.",
      EN: "Detects reversal logic: if large market volume appears at the very tips of candle wicks at chart extremes and price then reverses, it proves a counter limit order absorbed all the energy of the move.",
      KZ: "Бұрылу логикасын анықтайды: егер ірі нарық көлемі график экстремумдарында свеча көлеңкелерінің ұштарында пайда болса, содан кейін баға кері бұрылса — бұл қозғалыстың бүкіл энергиясын сіңірген қарсы лимиттік ордердің бар екенін дәлелдейді.",
    },
  },
  absorption: {
    desc: {
      RU: "Детектор пассивного лимитного поглощения рыночного натиска покупателей или продавцов крупными игроками.",
      EN: "A detector of passive limit absorption of buyers' or sellers' market pressure by large players.",
      KZ: "Сатып алушылар немесе сатушылардың нарықтық қысымын ірі ойыншылардың пассивті лимиттік сіңіруінің детекторы.",
    },
    details: {
      RU: "Показывает ситуации, когда вопреки сильным рыночным покупкам или продажам (агрессорам) цена упирается в непреодолимую стену лимитного уровня, полностью всасывая встречный объем без движения цены вперед.",
      EN: "Shows situations where, despite strong market buys or sells (aggressors), price runs into an impenetrable wall of a limit level, fully absorbing the opposing volume without moving price forward.",
      KZ: "Күшті нарықтық сатып алуларға немесе сатуларға (агрессорларға) қарамастан, баға лимиттік деңгейдің еңсерілмейтін қабырғасына тіреліп, бағаны алға жылжытпай қарсы көлемді толық сіңіретін жағдайларды көрсетеді.",
    },
  },
  volumeOnChart: {
    desc: {
      RU: "Накладывает вертикальную гистограмму проторгованного объема прямо поверх тела и теней свечей на график.",
      EN: "Overlays a vertical histogram of traded volume directly over candle bodies and wicks on the chart.",
      KZ: "Сатылған көлемнің тік гистограммасын графиктегі свеча денелері мен көлеңкелерінің үстіне тікелей салады.",
    },
    details: {
      RU: "Помогает сопоставлять ценовые уровни и проторгованную активность внутри каждой свечи, не переводя взгляд на отдельные подвальные индикаторы. Наглядно очерчивает ценовые зоны, вызвавшие наибольший интерес трейдеров.",
      EN: "Helps you match price levels with traded activity inside each candle without switching to separate sub-panels. Clearly outlines the price zones that drew the most trader interest.",
      KZ: "Бөлек панельдерге ауыспай-ақ, әр свеча ішіндегі баға деңгейлері мен сауда белсенділігін салыстыруға көмектеседі. Трейдерлердің ең көп қызығушылығын тудырған баға аймақтарын анық белгілейді.",
    },
  },
  delta: {
    desc: {
      RU: "Рыночная дельту — чистая разница между агрессивными рыночными покупками (Market Buys) и продажами (Market Sells) по каждой свече.",
      EN: "Market delta — the net difference between aggressive Market Buys and Market Sells for each candle.",
      KZ: "Нарықтық дельта — әр свеча бойынша агрессивті нарықтық сатып алулар (Market Buys) мен сатулардың (Market Sells) арасындағы таза айырмашылық.",
    },
    details: {
      RU: "Отвечает на вопрос, кто прямо сейчас доминирует на рынке — быки или медведи. Положительная (зеленая) дельта означает перевес рыночных покупок, отрицательная (красная) — преобладание рыночных продаж.",
      EN: "Answers who dominates the market right now — bulls or bears. Positive (green) delta means market buys prevail, negative (red) means market sells prevail.",
      KZ: "Дәл қазір нарықта кім үстем — бұқалар ма, аюлар ма деген сұраққа жауап береді. Оң (жасыл) дельта нарықтық сатып алулардың басымдығын, теріс (қызыл) нарықтық сатулардың басымдығын білдіреді.",
    },
  },
  cvd: {
    desc: {
      RU: "Кумулятивная дельта объема (Cumulative Volume Delta), суммирующая значения дельты нарастающим итогом на протяжении всего графика.",
      EN: "Cumulative Volume Delta that sums delta values on a running total across the whole chart.",
      KZ: "Бүкіл график бойында дельта мәндерін жинақтап қосатын Cumulative Volume Delta.",
    },
    details: {
      RU: "Используется для поиска рыночных скрытых дивергенций: например, если цена движется вверх к новым вершинам, а линия CVD падает, это признак сильного лимитного давления продавцов и скорого разворота цены вниз.",
      EN: "Used to find hidden market divergences: e.g. if price moves up to new highs while the CVD line falls, it signals strong limit selling pressure and an imminent reversal down.",
      KZ: "Жасырын нарықтық дивергенцияларды табу үшін қолданылады: мысалы, баға жаңа шыңдарға көтерілгенде CVD сызығы төмендесе — бұл сатушылардың күшті лимиттік қысымын және бағаның жақын арада төмен бұрылуын білдіреді.",
    },
  },
  clusterSearch: {
    desc: {
      RU: "Сканер аномальных горизонтальных объемов (кластеров) внутри свечей по индивидуально настроенным средним и крупным фильтрам.",
      EN: "A scanner of anomalous horizontal volumes (clusters) inside candles by individually tuned medium and large filters.",
      KZ: "Жеке бапталған орташа және үлкен сүзгілер бойынша свечалар ішіндегі аномалды көлденең көлемдерді (кластерлерді) сканерлеуші.",
    },
    details: {
      RU: "Автоматически подсвечивает крупные фильтрации на графике различными фигурами(круг, квадрат, ромб). Помогает мгновенно находить крупные покупки и продажи на рынке с перевесом одной из сторон.",
      EN: "Automatically highlights large filtered clusters on the chart with different shapes (circle, square, rhombus). Helps you instantly spot large buys and sells with one side prevailing.",
      KZ: "Графиктегі ірі сүзілген кластерлерді әртүрлі фигуралармен (шеңбер, шаршы, ромб) автоматты түрде белгілейді. Бір жақтың басымдығымен ірі сатып алулар мен сатуларды бірден табуға көмектеседі.",
    },
  },
  stackedImbalance: {
    desc: {
      RU: "Строит зоны последовательных рыночных дисбалансов (Stacked Imbalances) покупателей и продавцов на нескольких уровнях цены подряд.",
      EN: "Builds zones of consecutive market imbalances (Stacked Imbalances) of buyers and sellers across several price levels in a row.",
      KZ: "Сатып алушылар мен сатушылардың бірнеше баға деңгейінде қатарынан болатын дәйекті нарықтық дисбаланстарының (Stacked Imbalances) аймақтарын құрады.",
    },
    details: {
      RU: "Показывает агрессивную рыночную однонаправленную инициативу. Складывание дисбалансов (например, когда рыночный спрос многократно превышает лимитное предложение 3 уровня подряд) образует сильнейшие зоны поддержки или сопротивления на будущее.",
      EN: "Shows aggressive one-directional market initiative. Stacking of imbalances (e.g. when market demand repeatedly exceeds limit supply across 3 levels in a row) forms the strongest future support or resistance zones.",
      KZ: "Агрессивті бір бағытты нарықтық бастаманы көрсетеді. Дисбаланстардың үйілуі (мысалы, нарықтық сұраныс лимиттік ұсыныстан қатарынан 3 деңгейде бірнеше есе асып кеткенде) болашақ ең күшті қолдау немесе қарсылық аймақтарын құрады.",
    },
  },
  depthOfMarket: {
    desc: {
      RU: "Отображает горизонтальную гистограмму лимитных заявок (биржевой стакан) непосредственно на графике у ценовой шкалы.",
      EN: "Displays a horizontal histogram of limit orders (the order book) directly on the chart near the price scale.",
      KZ: "Лимиттік тапсырыстардың (биржа стаканы) көлденең гистограммасын графикте баға шкаласының жанында тікелей көрсетеді.",
    },
    details: {
      RU: "Показывает распределение крупных лимитных заявок на покупку (Bids) и продажу (Asks). Помогает моментально идентифицировать сильные стены сопротивлений и поддержек, приближение к которым может вызвать отскок или ускорение пробоя.",
      EN: "Shows the distribution of large limit buy (Bids) and sell (Asks) orders. Helps instantly identify strong resistance and support walls whose approach may trigger a bounce or accelerate a breakout.",
      KZ: "Ірі лимиттік сатып алу (Bids) және сату (Asks) тапсырыстарының таралуын көрсетеді. Жақындауы серпілісті немесе бұзылудың үдеуін тудыруы мүмкін күшті қарсылық пен қолдау қабырғаларын бірден анықтауға көмектеседі.",
    },
  },
  rsi: {
    desc: {
      RU: "Индекс относительной силы (RSI) — осциллятор со шкалой 0–100, измеряющий скорость и величину ценовых движений по close-ценам свечей.",
      EN: "The Relative Strength Index (RSI) — an oscillator on a 0–100 scale measuring the speed and magnitude of price moves by candle close prices.",
      KZ: "Салыстырмалы күш индексі (RSI) — свечалардың close бағалары бойынша баға қозғалысының жылдамдығы мен шамасын өлшейтін 0–100 шкаласындағы осциллятор.",
    },
    details: {
      RU: "Значения выше 70 указывают на перекупленность (вероятен откат вниз), ниже 30 — на перепроданность (вероятен отскок вверх). Расхождения линии RSI с ценой используются для поиска разворотов. Период по умолчанию 14 (формула Уайлдера).",
      EN: "Values above 70 indicate overbought (a pullback down is likely), below 30 — oversold (a bounce up is likely). RSI–price divergences are used to spot reversals. Default period is 14 (Wilder's formula).",
      KZ: "70-тен жоғары мәндер артық сатып алуды (төмен қарай кері қайту ықтимал), 30-дан төмен — артық сатуды (жоғары қарай серпіліс ықтимал) көрсетеді. RSI сызығының бағамен алшақтығы бұрылыстарды табу үшін қолданылады. Әдепкі кезең 14 (Уайлдер формуласы).",
    },
  },
  bidAskRatio: {
    desc: {
      RU: "Соотношение глубины стакана bid/ask в диапазоне ±N% от цены. Зелёный — перевес лимитных бидов, красный — перевес асков. Только futures.",
      EN: "The bid/ask order-book depth ratio within ±N% of price. Green — limit bids prevail, red — asks prevail. Futures only.",
      KZ: "Бағадан ±N% диапазонындағы стакан тереңдігінің bid/ask арақатынасы. Жасыл — лимиттік bid басым, қызыл — ask басым. Тек futures.",
    },
    details: {
      RU: "Значение = (bid − ask) / (bid + ask) по суммарному лимитному объёму в полосе ±1/3/5%. Диапазон −1..+1: ближе к +1 — плотная поддержка снизу, ближе к −1 — давление сверху. Данные берутся из истории снапшотов стакана на бэкенде.",
      EN: "Value = (bid − ask) / (bid + ask) over total limit volume in the ±1/3/5% band. Range −1..+1: closer to +1 means dense support below, closer to −1 means pressure from above. Data comes from order-book snapshot history on the backend.",
      KZ: "Мән = (bid − ask) / (bid + ask) ±1/3/5% жолағындағы жиынтық лимиттік көлем бойынша. Диапазон −1..+1: +1-ге жақын — төменде тығыз қолдау, −1-ге жақын — жоғарыдан қысым. Деректер бэкендтегі стакан снапшоттарының тарихынан алынады.",
    },
  },
  longShortRatio: {
    desc: {
      RU: "Глобальное соотношение числа аккаунтов в long к числу в short по всем биржевым счетам. Значение >1 — перевес лонгов, <1 — перевес шортов. Только futures.",
      EN: "The global ratio of accounts in long to accounts in short across all exchange accounts. Value >1 — longs prevail, <1 — shorts prevail. Futures only.",
      KZ: "Барлық биржа есептік жазбалары бойынша long есептік жазбалар санының short санына жаһандық арақатынасы. Мән >1 — лонгтар басым, <1 — шорттар басым. Тек futures.",
    },
    details: {
      RU: "Источник — статистика Binance globalLongShortAccountRatio (период 5 мин). Режим «Ratio» показывает само соотношение (нейтраль = 1.0), режим «Long %» — долю лонг-аккаунтов = ratio/(ratio+1)·100 (нейтраль = 50%). Данные берутся из истории на бэкенде.",
      EN: "Source — Binance globalLongShortAccountRatio statistics (5-min period). 'Ratio' mode shows the ratio itself (neutral = 1.0), 'Long %' mode — the share of long accounts = ratio/(ratio+1)·100 (neutral = 50%). Data comes from history on the backend.",
      KZ: "Дереккөз — Binance globalLongShortAccountRatio статистикасы (5 мин кезең). «Ratio» режимі арақатынастың өзін көрсетеді (бейтарап = 1.0), «Long %» режимі — лонг есептік жазбалардың үлесі = ratio/(ratio+1)·100 (бейтарап = 50%). Деректер бэкендтегі тарихтан алынады.",
    },
  },
  buySellZone: {
    desc: {
      RU: "Композитный осциллятор 0..100, объединяющий long/short ratio (инверсия), RSI, импульс MACD и баланс стакана bid/ask в единый индекс перевеса покупателей/продавцов. Только futures.",
      EN: "A composite 0..100 oscillator combining long/short ratio (inverted), RSI, MACD momentum and bid/ask order-book balance into a single buyer/seller dominance index. Futures only.",
      KZ: "Long/short ratio (инверсия), RSI, MACD импульсі және стакан bid/ask балансын сатып алушы/сатушы басымдығының бірыңғай индексіне біріктіретін 0..100 композиттік осциллятор. Тек futures.",
    },
    details: {
      RU: "Каждый компонент нормируется в 0..100 и усредняется по доступным с весами (по умолчанию LS 0.35, RSI 0.25, MACD 0.20, Bar 0.20). Значения внутри коридора 35–65 — баланс; выше 80 — перегрев покупателей (красная заливка), ниже 20 — перегрев продавцов (зелёная). Если у свечи нет данных стакана/соотношения или мало истории для z-score, компонент исключается, а вес перераспределяется на оставшиеся.",
      EN: "Each component is normalized to 0..100 and averaged over those available with weights (default LS 0.35, RSI 0.25, MACD 0.20, Bar 0.20). Values inside the 35–65 corridor mean balance; above 80 — buyer overheat (red fill), below 20 — seller overheat (green). If a candle lacks order-book/ratio data or has too little history for a z-score, the component is dropped and its weight is redistributed to the rest.",
      KZ: "Әр компонент 0..100-ге қалыпқа келтіріледі және қолжетімділері салмақтармен орташаланады (әдепкі LS 0.35, RSI 0.25, MACD 0.20, Bar 0.20). 35–65 дәлізі ішіндегі мәндер — тепе-теңдік; 80-нен жоғары — сатып алушылардың қызуы (қызыл толтыру), 20-дан төмен — сатушылардың қызуы (жасыл). Егер свечада стакан/арақатынас деректері болмаса немесе z-score үшін тарих аз болса, компонент алынып тасталып, оның салмағы қалғандарына қайта бөлінеді.",
    },
  },
  dynamicLevels: {
    desc: {
      RU: "Динамические уровни POC и зона Value Area (70%) объёмного профиля, рассчитанные отдельно по каждому периоду (час/день/неделя/месяц/все бары).",
      EN: "Dynamic POC levels and a 70% Value Area zone of the volume profile, computed per period (hour/day/week/month/all bars).",
      KZ: "Әр кезең бойынша (сағат/күн/апта/ай/барлық барлар) есептелген көлем профилінің динамикалық POC деңгейлері және Value Area (70%) аймағы.",
    },
    details: {
      RU: "Профиль объёма агрегируется по выбранному периоду: для каждого находится POC (цена с максимальным объёмом) и Value Area — диапазон вокруг POC, вмещающий 70% объёма (VAH сверху, VAL снизу). Уровни рисуются ступеньками на своих участках времени; текущий незакрытый период тянется до правого края графика.",
      EN: "The volume profile is aggregated over the selected period: each period yields a POC (the price with the maximum volume) and a Value Area — the range around POC holding 70% of volume (VAH above, VAL below). Levels are drawn as steps over their own time spans; the current open period extends to the right edge of the chart.",
      KZ: "Көлем профилі таңдалған кезең бойынша біріктіріледі: әр кезеңде POC (максималды көлемі бар баға) және Value Area — POC айналасындағы көлемнің 70%-ын қамтитын диапазон (жоғарыда VAH, төменде VAL) анықталады. Деңгейлер өз уақыт аралықтарында сатылап сызылады; ағымдағы жабылмаған кезең графиктің оң шетіне дейін созылады.",
    },
  },
}
