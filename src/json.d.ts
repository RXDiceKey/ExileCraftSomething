// Game data JSON is large; typed by hand in src/engine/data.ts instead of letting TS infer it.
declare module '*.json' {
  const value: unknown
  export default value
}
