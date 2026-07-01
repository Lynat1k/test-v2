import type { IndicatorModule } from "./types";
import type { ClusterCandle } from "../types";

export interface NetOpenInterestSettings {
  netOiShowLong?: boolean;
  netOiShowShort?: boolean;
  netOiDisplayMode?: "line" | "candles";
  netOiFlowType?: "market" | "limit";
  netOiSmoothing?: number;
  netOiLongColor?: string;
  netOiShortColor?: string;
}

/**
 * Net OI Long/Short — подвальный индикатор оценки позиционирования по открытому
 * интересу. ОДНА панель, ДВЕ серии: Net Long (NL) и Net Short (NS), обе в % от
 * текущего OI. Только futures. Считается ЧИСТО на фронте из уже загруженных
 * данных: OI-ряд (fetchOpenInterest, переиспользуется) + поток сделок каждой
 * свечи (candle.delta уже нормализована как BUY−SELL, candle.volume).
 *
 * Идея: изменение OI между барами (dOI) распределяется между лонгами и шортами
 * по доле покупок/продаж в потоке. Доли усиливаются НЕЛИНЕЙНО (степень p =
 * 1/smoothing) — иначе при почти симметричном потоке (~50/50) линии NL/NS
 * сливаются и повторяют форму OI. Меньше smoothing → резче расхождение долей;
 * smoothing=1 → p=1 → линейное деление (как раньше). Приращения копятся
 * нарастающим итогом от начала загруженной истории, значения нормируются на
 * текущий OI. Здесь — метаданные, дефолты и чистая функция расчёта; фетч и
 * отрисовка в ClusterChart. Инвариант: longAdd+shortAdd = dOI на каждом баре.
 */

export interface NetOiPoint {
  t: number;
  nlPct: number | null;
  nsPct: number | null;
}

/**
 * Считает точки {t, nlPct, nsPct} по свечам, отсортированным по времени.
 * Модель — ВИДИМОЕ ОКНО (rebase-per-view, как CVD "visible"). Накопление ведётся
 * ТОЛЬКО в пределах [startIdx..endIdx] и обнуляется на левом крае окна; иначе
 * за всю загруженную историю копится монотонный дрейф. Бары вне окна → null (не
 * рисуются, не участвуют в авто-скейле). Индексы выхода совпадают с candles.
 *
 * Пер бар в окне с известным OI: dOI = oiNow − prevOi (0 на левом крае); доли
 * потока с нелинейным усилением (p=1/smoothing) + market/limit своп; при dOI≥0
 * набор `long/short += dOI·frac`, при dOI<0 закрытие (кресто-своп).
 * Нормировка ТЕКУЩИМ OI бара: nlPct=nlCum/oiNow·100, nsPct=nsCum/oiNow·100.
 * Серии НЕЗАВИСИМЫЕ (не зеркальные), НЕ схлопываются в одно (разные знаковые
 * накопления). Бары без OI → null (разрыв, накопители/prevOi не трогаем).
 *
 * @param candles   свечи (futures)
 * @param oiClose   доступ к OI-close для бакета по timestamp свечи (null если нет)
 * @param flowType  "market" → доли по тейкеру; "limit" → доли по мейкеру (своп)
 * @param smoothing [0.05..1] сила нелинейного усиления: меньше → шире размах
 * @param startIdx  первый видимый бар (включительно) — точка ребейза накопления
 * @param endIdx    последний видимый бар (включительно)
 */
export function computeNetOiPoints(
  candles: ClusterCandle[],
  oiClose: (timestamp: number) => number | null,
  flowType: "market" | "limit",
  smoothing: number,
  startIdx: number,
  endIdx: number,
): NetOiPoint[] {
  // p = 1/smoothing (>=1). Возводим объёмы покупок/продаж в степень p и берём
  // долю — так перевес усиливается нелинейно (p=1 → линейно ≈50/50).
  const p = 1 / Math.min(1, Math.max(0.05, smoothing));
  const lo = Math.max(0, startIdx);
  const hi = Math.min(candles.length - 1, endIdx);
  // Накопители ребейзятся с нуля на левом крае окна: prevOi=null → dOI на первом
  // видимом баре с известным OI = 0.
  let nlCum = 0;
  let nsCum = 0;
  let prevOi: number | null = null; // OI предыдущего бара С ИЗВЕСТНЫМ OI (в окне)
  const out: NetOiPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]!;
    // Бар вне видимого окна — накопление не трогаем, точка пустая.
    if (i < lo || i > hi) {
      out.push({ t: candle.timestamp, nlPct: null, nsPct: null });
      continue;
    }

    const oiNow = oiClose(candle.timestamp);
    if (oiNow === null || !(oiNow > 0)) {
      // Нет OI для бара — накопление не двигаем, точка пустая (разрыв).
      out.push({ t: candle.timestamp, nlPct: null, nsPct: null });
      continue;
    }

    const V = candle.volume;
    if (V > 0) {
      const takerBuy = Math.max(0, (V + candle.delta) / 2);
      const takerSell = Math.max(0, (V - candle.delta) / 2);
      // Нелинейное усиление: доля = bw/(bw+sw), bw/sw — объёмы в степени p.
      // Math.pow(0,p)=0 → guard на bw+sw==0 (нет потока → 50/50).
      const bw = Math.pow(takerBuy, p);
      const sw = Math.pow(takerSell, p);
      const buyFracTaker = bw + sw > 0 ? bw / (bw + sw) : 0.5;
      const sellFracTaker = 1 - buyFracTaker;
      // market → тейкер; limit → мейкер (доли меняются местами).
      const buyFrac = flowType === "market" ? buyFracTaker : sellFracTaker;
      const sellFrac = flowType === "market" ? sellFracTaker : buyFracTaker;
      const dOI = prevOi === null ? 0 : oiNow - prevOi;
      // Знаковые вклады: набор при dOI>0, закрытие при dOI<0 (кресто-своп).
      if (dOI >= 0) {
        nlCum += dOI * buyFrac;
        nsCum += dOI * sellFrac;
      } else {
        nlCum += dOI * sellFrac;
        nsCum += dOI * buyFrac;
      }
    }
    prevOi = oiNow;

    out.push({
      t: candle.timestamp,
      nlPct: (nlCum / oiNow) * 100,
      nsPct: (nsCum / oiNow) * 100,
    });
  }

  return out;
}

export const netOpenInterestIndicator: IndicatorModule & {
  defaultSettings: NetOpenInterestSettings;
  computeNetOiPoints: typeof computeNetOiPoints;
} = {
  id: "netOpenInterest",
  label: "(PROCLUSTER) Net OI Long/Short",
  category: "Все индикаторы",
  type: "Подвальный",
  description:
    "Оценка позиционирования по открытому интересу: две серии — Net Long и Net Short (в % от текущего OI). Прирост OI распределяется между лонгами и шортами по доле покупок/продаж в потоке. Только futures.",
  details:
    "Изменение OI между барами делится между лонгами и шортами пропорционально долям покупок и продаж (режим Market — по тейкеру, Limit — по мейкеру). Приращения копятся нарастающим итогом от начала загруженной истории и нормируются на текущий OI. Режим «Линия» — две линии NL/NS, «Свечи» — свечи по каждой серии (open=пред. значение, close=текущее). Считается на фронте, данные OI берутся из истории на бэкенде.",
  defaultSettings: {
    netOiShowLong: true,
    netOiShowShort: true,
    netOiDisplayMode: "candles",
    netOiFlowType: "limit",
    netOiSmoothing: 0.5,
    netOiLongColor: "#26a69a",
    netOiShortColor: "#ef5350",
  },
  isActiveDefault: false,
  computeNetOiPoints,
};
