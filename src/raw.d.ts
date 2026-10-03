declare module '*?raw' {
  const content: string;
  export default content;
}

declare module '*.css?inline' {
  const css: string;
  export default css;
}
