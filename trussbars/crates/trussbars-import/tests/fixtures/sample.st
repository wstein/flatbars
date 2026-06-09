<! a representative StringTemplate4 body (default <…> delimiters) !>
Title: <page.title>
<if(items)>
  <items:{ item | - <item.name; null="(unnamed)">: <item.html>
  }>
<elseif(loading)>
  Loading…
<else>
  Empty
<endif>
<users, scores:{ u, s | <u> scored <s>
}>
<@footer>default footer<@end>
