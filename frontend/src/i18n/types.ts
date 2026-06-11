type DeepKeys<T> = T extends Record<string, unknown>
  ? { [K in keyof T & string]: T[K] extends Record<string, unknown> ? `${K}.${DeepKeys<T[K]>}` : K }[keyof T & string]
  : never

type Dict = typeof import('./dictionaries/en').default

export type TranslationKey = DeepKeys<Dict>
