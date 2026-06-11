// output/ClassicBars.JS/foreign.js
function arityText(arity) {
  if (arity === void 0 || arity === null) return "any number of";
  if (typeof arity === "number") return "exactly " + arity;
  const [lo, hi] = arity;
  return hi == null || hi === Infinity ? "at least " + lo : lo + "\u2013" + hi;
}
function arityOk(arity, n) {
  if (arity === void 0 || arity === null) return true;
  if (typeof arity === "number") return n === arity;
  const [lo, hi] = arity;
  return n >= lo && (hi == null || hi === Infinity || n <= hi);
}
var callJsHelperImpl = (name2) => (descriptor) => (args) => {
  const fn = typeof descriptor === "function" ? descriptor : descriptor.fn;
  const arity = typeof descriptor === "function" ? void 0 : descriptor.arity;
  if (!arityOk(arity, args.length)) {
    return { tag: "arity", payload: name2 + ": expected " + arityText(arity) + " argument(s), got " + args.length };
  }
  try {
    const r = fn.apply(null, args);
    if (r && typeof r === "object" && typeof r.__fbSafe === "string") {
      return { tag: "safe", payload: r.__fbSafe };
    }
    return { tag: "ok", payload: r === void 0 ? null : r };
  } catch (e) {
    return { tag: "error", payload: String(e && e.message || e) };
  }
};
var callJsBlockHelperImpl = (name2) => (descriptor) => (args) => (currentCtx) => (hash) => (renderBody) => (renderInverse) => {
  const fn = typeof descriptor === "function" ? descriptor : descriptor.fn;
  const arity = typeof descriptor === "function" ? void 0 : descriptor.arity;
  if (!arityOk(arity, args.length)) {
    return { tag: "arity", payload: name2 + ": expected " + arityText(arity) + " argument(s), got " + args.length };
  }
  const unwrap3 = (r) => {
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const options = {
    hash: hash && typeof hash === "object" ? hash : {},
    fn: function(ctx2, opts) {
      return unwrap3(renderBody(arguments.length === 0 ? currentCtx : ctx2)(opts || {}));
    },
    inverse: function(ctx2, opts) {
      return unwrap3(renderInverse(arguments.length === 0 ? currentCtx : ctx2)(opts || {}));
    }
  };
  for (const k of ["ids", "loc", "lookupProperty"]) {
    Object.defineProperty(options, k, {
      get() {
        throw new Error("options." + k + " is not supported in a FlatBars block helper");
      }
    });
  }
  try {
    const r = fn.apply(currentCtx, args.concat([options]));
    if (r && typeof r === "object" && typeof r.__fbSafe === "string") return { tag: "safe", payload: r.__fbSafe };
    return { tag: "safe", payload: r === void 0 || r === null ? "" : String(r) };
  } catch (e) {
    return { tag: "error", payload: String(e && e.message || e) };
  }
};
var safe = (s) => ({ __fbSafe: typeof s === "string" ? s : String(s) });
var callJsTranslatorImpl = (translator) => (name2) => (args) => {
  try {
    const r = translator(name2, args);
    return r === void 0 || r === null ? { hit: false, value: "" } : { hit: true, value: String(r) };
  } catch (_e) {
    return { hit: false, value: "" };
  }
};
var callJsPathSchemaImpl = (schema) => (path2) => (value) => {
  try {
    return schema(path2, value) !== false;
  } catch (_e) {
    return true;
  }
};

// output/Control.Apply/foreign.js
var arrayApply = function(fs) {
  return function(xs) {
    var l = fs.length;
    var k = xs.length;
    var result2 = new Array(l * k);
    var n = 0;
    for (var i = 0; i < l; i++) {
      var f = fs[i];
      for (var j = 0; j < k; j++) {
        result2[n++] = f(xs[j]);
      }
    }
    return result2;
  };
};

// output/Control.Semigroupoid/index.js
var semigroupoidFn = {
  compose: function(f) {
    return function(g) {
      return function(x) {
        return f(g(x));
      };
    };
  }
};

// output/Control.Category/index.js
var identity = function(dict) {
  return dict.identity;
};
var categoryFn = {
  identity: function(x) {
    return x;
  },
  Semigroupoid0: function() {
    return semigroupoidFn;
  }
};

// output/Data.Boolean/index.js
var otherwise = true;

// output/Data.Function/index.js
var flip = function(f) {
  return function(b) {
    return function(a) {
      return f(a)(b);
    };
  };
};
var $$const = function(a) {
  return function(v) {
    return a;
  };
};

// output/Data.Functor/foreign.js
var arrayMap = function(f) {
  return function(arr2) {
    var l = arr2.length;
    var result2 = new Array(l);
    for (var i = 0; i < l; i++) {
      result2[i] = f(arr2[i]);
    }
    return result2;
  };
};

// output/Data.Unit/foreign.js
var unit = void 0;

// output/Type.Proxy/index.js
var $$Proxy = /* @__PURE__ */ (function() {
  function $$Proxy2() {
  }
  ;
  $$Proxy2.value = new $$Proxy2();
  return $$Proxy2;
})();

// output/Data.Functor/index.js
var map = function(dict) {
  return dict.map;
};
var mapFlipped = function(dictFunctor) {
  var map115 = map(dictFunctor);
  return function(fa) {
    return function(f) {
      return map115(f)(fa);
    };
  };
};
var $$void = function(dictFunctor) {
  return map(dictFunctor)($$const(unit));
};
var functorArray = {
  map: arrayMap
};

// output/Control.Apply/index.js
var identity2 = /* @__PURE__ */ identity(categoryFn);
var applyArray = {
  apply: arrayApply,
  Functor0: function() {
    return functorArray;
  }
};
var apply = function(dict) {
  return dict.apply;
};
var applySecond = function(dictApply) {
  var apply1 = apply(dictApply);
  var map37 = map(dictApply.Functor0());
  return function(a) {
    return function(b) {
      return apply1(map37($$const(identity2))(a))(b);
    };
  };
};

// output/Control.Applicative/index.js
var pure = function(dict) {
  return dict.pure;
};
var when = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      if (v) {
        return v1;
      }
      ;
      if (!v) {
        return pure1(unit);
      }
      ;
      throw new Error("Failed pattern match at Control.Applicative (line 63, column 1 - line 63, column 63): " + [v.constructor.name, v1.constructor.name]);
    };
  };
};
var applicativeArray = {
  pure: function(x) {
    return [x];
  },
  Apply0: function() {
    return applyArray;
  }
};

// output/Data.Array/foreign.js
var rangeImpl = function(start, end) {
  var step2 = start > end ? -1 : 1;
  var result2 = new Array(step2 * (end - start) + 1);
  var i = start, n = 0;
  while (i !== end) {
    result2[n++] = i;
    i += step2;
  }
  result2[n] = i;
  return result2;
};
var replicateFill = function(count, value) {
  if (count < 1) {
    return [];
  }
  var result2 = new Array(count);
  return result2.fill(value);
};
var replicatePolyfill = function(count, value) {
  var result2 = [];
  var n = 0;
  for (var i = 0; i < count; i++) {
    result2[n++] = value;
  }
  return result2;
};
var replicateImpl = typeof Array.prototype.fill === "function" ? replicateFill : replicatePolyfill;
var fromFoldableImpl = /* @__PURE__ */ (function() {
  function Cons2(head4, tail2) {
    this.head = head4;
    this.tail = tail2;
  }
  var emptyList = {};
  function curryCons(head4) {
    return function(tail2) {
      return new Cons2(head4, tail2);
    };
  }
  function listToArray(list) {
    var result2 = [];
    var count = 0;
    var xs = list;
    while (xs !== emptyList) {
      result2[count++] = xs.head;
      xs = xs.tail;
    }
    return result2;
  }
  return function(foldr4, xs) {
    return listToArray(foldr4(curryCons)(emptyList)(xs));
  };
})();
var length = function(xs) {
  return xs.length;
};
var unconsImpl = function(empty5, next, xs) {
  return xs.length === 0 ? empty5({}) : next(xs[0])(xs.slice(1));
};
var indexImpl = function(just, nothing, xs, i) {
  return i < 0 || i >= xs.length ? nothing : just(xs[i]);
};
var findMapImpl = function(nothing, isJust2, f, xs) {
  for (var i = 0; i < xs.length; i++) {
    var result2 = f(xs[i]);
    if (isJust2(result2)) return result2;
  }
  return nothing;
};
var findIndexImpl = function(just, nothing, f, xs) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (f(xs[i])) return just(i);
  }
  return nothing;
};
var findLastIndexImpl = function(just, nothing, f, xs) {
  for (var i = xs.length - 1; i >= 0; i--) {
    if (f(xs[i])) return just(i);
  }
  return nothing;
};
var reverse = function(l) {
  return l.slice().reverse();
};
var concat = function(xss) {
  if (xss.length <= 1e4) {
    return Array.prototype.concat.apply([], xss);
  }
  var result2 = [];
  for (var i = 0, l = xss.length; i < l; i++) {
    var xs = xss[i];
    for (var j = 0, m = xs.length; j < m; j++) {
      result2.push(xs[j]);
    }
  }
  return result2;
};
var filterImpl = function(f, xs) {
  return xs.filter(f);
};
var sortByImpl = /* @__PURE__ */ (function() {
  function mergeFromTo(compare4, fromOrdering, xs1, xs2, from2, to) {
    var mid;
    var i;
    var j;
    var k;
    var x;
    var y;
    var c;
    mid = from2 + (to - from2 >> 1);
    if (mid - from2 > 1) mergeFromTo(compare4, fromOrdering, xs2, xs1, from2, mid);
    if (to - mid > 1) mergeFromTo(compare4, fromOrdering, xs2, xs1, mid, to);
    i = from2;
    j = mid;
    k = from2;
    while (i < mid && j < to) {
      x = xs2[i];
      y = xs2[j];
      c = fromOrdering(compare4(x)(y));
      if (c > 0) {
        xs1[k++] = y;
        ++j;
      } else {
        xs1[k++] = x;
        ++i;
      }
    }
    while (i < mid) {
      xs1[k++] = xs2[i++];
    }
    while (j < to) {
      xs1[k++] = xs2[j++];
    }
  }
  return function(compare4, fromOrdering, xs) {
    var out;
    if (xs.length < 2) return xs;
    out = xs.slice(0);
    mergeFromTo(compare4, fromOrdering, out, xs.slice(0), 0, xs.length);
    return out;
  };
})();
var sliceImpl = function(s, e, l) {
  return l.slice(s, e);
};
var zipWithImpl = function(f, xs, ys) {
  var l = xs.length < ys.length ? xs.length : ys.length;
  var result2 = new Array(l);
  for (var i = 0; i < l; i++) {
    result2[i] = f(xs[i])(ys[i]);
  }
  return result2;
};
var anyImpl = function(p, xs) {
  var len = xs.length;
  for (var i = 0; i < len; i++) {
    if (p(xs[i])) return true;
  }
  return false;
};
var allImpl = function(p, xs) {
  var len = xs.length;
  for (var i = 0; i < len; i++) {
    if (!p(xs[i])) return false;
  }
  return true;
};
var unsafeIndexImpl = function(xs, n) {
  return xs[n];
};

// output/Data.Semigroup/foreign.js
var concatString = function(s1) {
  return function(s2) {
    return s1 + s2;
  };
};
var concatArray = function(xs) {
  return function(ys) {
    if (xs.length === 0) return ys;
    if (ys.length === 0) return xs;
    return xs.concat(ys);
  };
};

// output/Data.Symbol/index.js
var reflectSymbol = function(dict) {
  return dict.reflectSymbol;
};

// output/Record.Unsafe/foreign.js
var unsafeGet = function(label) {
  return function(rec) {
    return rec[label];
  };
};

// output/Data.Semigroup/index.js
var semigroupString = {
  append: concatString
};
var semigroupArray = {
  append: concatArray
};
var append = function(dict) {
  return dict.append;
};

// output/Control.Bind/foreign.js
var arrayBind = function(arr2) {
  return function(f) {
    var result2 = [];
    for (var i = 0, l = arr2.length; i < l; i++) {
      Array.prototype.push.apply(result2, f(arr2[i]));
    }
    return result2;
  };
};

// output/Control.Bind/index.js
var identity3 = /* @__PURE__ */ identity(categoryFn);
var discard = function(dict) {
  return dict.discard;
};
var bindArray = {
  bind: arrayBind,
  Apply0: function() {
    return applyArray;
  }
};
var bind = function(dict) {
  return dict.bind;
};
var discardUnit = {
  discard: function(dictBind) {
    return bind(dictBind);
  }
};
var join = function(dictBind) {
  var bind110 = bind(dictBind);
  return function(m) {
    return bind110(m)(identity3);
  };
};

// output/Control.Monad/index.js
var ap = function(dictMonad) {
  var bind20 = bind(dictMonad.Bind1());
  var pure19 = pure(dictMonad.Applicative0());
  return function(f) {
    return function(a) {
      return bind20(f)(function(f$prime) {
        return bind20(a)(function(a$prime) {
          return pure19(f$prime(a$prime));
        });
      });
    };
  };
};

// output/Data.Bounded/foreign.js
var topInt = 2147483647;
var bottomInt = -2147483648;
var topChar = String.fromCharCode(65535);
var bottomChar = String.fromCharCode(0);
var topNumber = Number.POSITIVE_INFINITY;
var bottomNumber = Number.NEGATIVE_INFINITY;

// output/Data.Ord/foreign.js
var unsafeCompareImpl = function(lt) {
  return function(eq8) {
    return function(gt) {
      return function(x) {
        return function(y) {
          return x < y ? lt : x === y ? eq8 : gt;
        };
      };
    };
  };
};
var ordIntImpl = unsafeCompareImpl;
var ordNumberImpl = unsafeCompareImpl;
var ordStringImpl = unsafeCompareImpl;
var ordCharImpl = unsafeCompareImpl;

// output/Data.Eq/foreign.js
var refEq = function(r1) {
  return function(r2) {
    return r1 === r2;
  };
};
var eqBooleanImpl = refEq;
var eqIntImpl = refEq;
var eqNumberImpl = refEq;
var eqCharImpl = refEq;
var eqStringImpl = refEq;
var eqArrayImpl = function(f) {
  return function(xs) {
    return function(ys) {
      if (xs.length !== ys.length) return false;
      for (var i = 0; i < xs.length; i++) {
        if (!f(xs[i])(ys[i])) return false;
      }
      return true;
    };
  };
};

// output/Data.Eq/index.js
var eqUnit = {
  eq: function(v) {
    return function(v1) {
      return true;
    };
  }
};
var eqString = {
  eq: eqStringImpl
};
var eqRowNil = {
  eqRecord: function(v) {
    return function(v1) {
      return function(v2) {
        return true;
      };
    };
  }
};
var eqRecord = function(dict) {
  return dict.eqRecord;
};
var eqRec = function() {
  return function(dictEqRecord) {
    return {
      eq: eqRecord(dictEqRecord)($$Proxy.value)
    };
  };
};
var eqNumber = {
  eq: eqNumberImpl
};
var eqInt = {
  eq: eqIntImpl
};
var eqChar = {
  eq: eqCharImpl
};
var eqBoolean = {
  eq: eqBooleanImpl
};
var eq = function(dict) {
  return dict.eq;
};
var eq2 = /* @__PURE__ */ eq(eqBoolean);
var eqArray = function(dictEq) {
  return {
    eq: eqArrayImpl(eq(dictEq))
  };
};
var eqRowCons = function(dictEqRecord) {
  var eqRecord1 = eqRecord(dictEqRecord);
  return function() {
    return function(dictIsSymbol) {
      var reflectSymbol2 = reflectSymbol(dictIsSymbol);
      return function(dictEq) {
        var eq38 = eq(dictEq);
        return {
          eqRecord: function(v) {
            return function(ra) {
              return function(rb) {
                var tail2 = eqRecord1($$Proxy.value)(ra)(rb);
                var key = reflectSymbol2($$Proxy.value);
                var get2 = unsafeGet(key);
                return eq38(get2(ra))(get2(rb)) && tail2;
              };
            };
          }
        };
      };
    };
  };
};
var notEq = function(dictEq) {
  var eq38 = eq(dictEq);
  return function(x) {
    return function(y) {
      return eq2(eq38(x)(y))(false);
    };
  };
};

// output/Data.Ordering/index.js
var LT = /* @__PURE__ */ (function() {
  function LT2() {
  }
  ;
  LT2.value = new LT2();
  return LT2;
})();
var GT = /* @__PURE__ */ (function() {
  function GT2() {
  }
  ;
  GT2.value = new GT2();
  return GT2;
})();
var EQ = /* @__PURE__ */ (function() {
  function EQ2() {
  }
  ;
  EQ2.value = new EQ2();
  return EQ2;
})();
var eqOrdering = {
  eq: function(v) {
    return function(v1) {
      if (v instanceof LT && v1 instanceof LT) {
        return true;
      }
      ;
      if (v instanceof GT && v1 instanceof GT) {
        return true;
      }
      ;
      if (v instanceof EQ && v1 instanceof EQ) {
        return true;
      }
      ;
      return false;
    };
  }
};

// output/Data.Ring/foreign.js
var intSub = function(x) {
  return function(y) {
    return x - y | 0;
  };
};
var numSub = function(n1) {
  return function(n2) {
    return n1 - n2;
  };
};

// output/Data.Semiring/foreign.js
var intAdd = function(x) {
  return function(y) {
    return x + y | 0;
  };
};
var intMul = function(x) {
  return function(y) {
    return x * y | 0;
  };
};
var numAdd = function(n1) {
  return function(n2) {
    return n1 + n2;
  };
};
var numMul = function(n1) {
  return function(n2) {
    return n1 * n2;
  };
};

// output/Data.Semiring/index.js
var semiringNumber = {
  add: numAdd,
  zero: 0,
  mul: numMul,
  one: 1
};
var semiringInt = {
  add: intAdd,
  zero: 0,
  mul: intMul,
  one: 1
};
var mul = function(dict) {
  return dict.mul;
};
var add = function(dict) {
  return dict.add;
};

// output/Data.Ring/index.js
var sub = function(dict) {
  return dict.sub;
};
var ringNumber = {
  sub: numSub,
  Semiring0: function() {
    return semiringNumber;
  }
};
var ringInt = {
  sub: intSub,
  Semiring0: function() {
    return semiringInt;
  }
};

// output/Data.Ord/index.js
var ordString = /* @__PURE__ */ (function() {
  return {
    compare: ordStringImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqString;
    }
  };
})();
var ordNumber = /* @__PURE__ */ (function() {
  return {
    compare: ordNumberImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqNumber;
    }
  };
})();
var ordInt = /* @__PURE__ */ (function() {
  return {
    compare: ordIntImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqInt;
    }
  };
})();
var ordChar = /* @__PURE__ */ (function() {
  return {
    compare: ordCharImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqChar;
    }
  };
})();
var compare = function(dict) {
  return dict.compare;
};
var comparing = function(dictOrd) {
  var compare32 = compare(dictOrd);
  return function(f) {
    return function(x) {
      return function(y) {
        return compare32(f(x))(f(y));
      };
    };
  };
};
var max = function(dictOrd) {
  var compare32 = compare(dictOrd);
  return function(x) {
    return function(y) {
      var v = compare32(x)(y);
      if (v instanceof LT) {
        return y;
      }
      ;
      if (v instanceof EQ) {
        return x;
      }
      ;
      if (v instanceof GT) {
        return x;
      }
      ;
      throw new Error("Failed pattern match at Data.Ord (line 181, column 3 - line 184, column 12): " + [v.constructor.name]);
    };
  };
};
var min = function(dictOrd) {
  var compare32 = compare(dictOrd);
  return function(x) {
    return function(y) {
      var v = compare32(x)(y);
      if (v instanceof LT) {
        return x;
      }
      ;
      if (v instanceof EQ) {
        return x;
      }
      ;
      if (v instanceof GT) {
        return y;
      }
      ;
      throw new Error("Failed pattern match at Data.Ord (line 172, column 3 - line 175, column 12): " + [v.constructor.name]);
    };
  };
};
var clamp = function(dictOrd) {
  var min1 = min(dictOrd);
  var max1 = max(dictOrd);
  return function(low) {
    return function(hi) {
      return function(x) {
        return min1(hi)(max1(low)(x));
      };
    };
  };
};

// output/Data.Bounded/index.js
var top = function(dict) {
  return dict.top;
};
var boundedInt = {
  top: topInt,
  bottom: bottomInt,
  Ord0: function() {
    return ordInt;
  }
};
var boundedChar = {
  top: topChar,
  bottom: bottomChar,
  Ord0: function() {
    return ordChar;
  }
};
var bottom = function(dict) {
  return dict.bottom;
};

// output/Data.Show/foreign.js
var showIntImpl = function(n) {
  return n.toString();
};
var showNumberImpl = function(n) {
  var str2 = n.toString();
  return isNaN(str2 + ".0") ? str2 : str2 + ".0";
};
var showStringImpl = function(s) {
  var l = s.length;
  return '"' + s.replace(
    /[\0-\x1F\x7F"\\]/g,
    // eslint-disable-line no-control-regex
    function(c, i) {
      switch (c) {
        case '"':
        case "\\":
          return "\\" + c;
        case "\x07":
          return "\\a";
        case "\b":
          return "\\b";
        case "\f":
          return "\\f";
        case "\n":
          return "\\n";
        case "\r":
          return "\\r";
        case "	":
          return "\\t";
        case "\v":
          return "\\v";
      }
      var k = i + 1;
      var empty5 = k < l && s[k] >= "0" && s[k] <= "9" ? "\\&" : "";
      return "\\" + c.charCodeAt(0).toString(10) + empty5;
    }
  ) + '"';
};
var showArrayImpl = function(f) {
  return function(xs) {
    var ss = [];
    for (var i = 0, l = xs.length; i < l; i++) {
      ss[i] = f(xs[i]);
    }
    return "[" + ss.join(",") + "]";
  };
};

// output/Data.Show/index.js
var showString = {
  show: showStringImpl
};
var showNumber = {
  show: showNumberImpl
};
var showInt = {
  show: showIntImpl
};
var showBoolean = {
  show: function(v) {
    if (v) {
      return "true";
    }
    ;
    if (!v) {
      return "false";
    }
    ;
    throw new Error("Failed pattern match at Data.Show (line 29, column 1 - line 31, column 23): " + [v.constructor.name]);
  }
};
var show = function(dict) {
  return dict.show;
};
var showArray = function(dictShow) {
  return {
    show: showArrayImpl(show(dictShow))
  };
};

// output/Data.Maybe/index.js
var identity4 = /* @__PURE__ */ identity(categoryFn);
var Nothing = /* @__PURE__ */ (function() {
  function Nothing2() {
  }
  ;
  Nothing2.value = new Nothing2();
  return Nothing2;
})();
var Just = /* @__PURE__ */ (function() {
  function Just2(value0) {
    this.value0 = value0;
  }
  ;
  Just2.create = function(value0) {
    return new Just2(value0);
  };
  return Just2;
})();
var maybe = function(v) {
  return function(v1) {
    return function(v2) {
      if (v2 instanceof Nothing) {
        return v;
      }
      ;
      if (v2 instanceof Just) {
        return v1(v2.value0);
      }
      ;
      throw new Error("Failed pattern match at Data.Maybe (line 237, column 1 - line 237, column 51): " + [v.constructor.name, v1.constructor.name, v2.constructor.name]);
    };
  };
};
var isNothing = /* @__PURE__ */ maybe(true)(/* @__PURE__ */ $$const(false));
var isJust = /* @__PURE__ */ maybe(false)(/* @__PURE__ */ $$const(true));
var functorMaybe = {
  map: function(v) {
    return function(v1) {
      if (v1 instanceof Just) {
        return new Just(v(v1.value0));
      }
      ;
      return Nothing.value;
    };
  }
};
var map2 = /* @__PURE__ */ map(functorMaybe);
var fromMaybe = function(a) {
  return maybe(a)(identity4);
};
var fromJust = function() {
  return function(v) {
    if (v instanceof Just) {
      return v.value0;
    }
    ;
    throw new Error("Failed pattern match at Data.Maybe (line 288, column 1 - line 288, column 46): " + [v.constructor.name]);
  };
};
var eqMaybe = function(dictEq) {
  var eq8 = eq(dictEq);
  return {
    eq: function(x) {
      return function(y) {
        if (x instanceof Nothing && y instanceof Nothing) {
          return true;
        }
        ;
        if (x instanceof Just && y instanceof Just) {
          return eq8(x.value0)(y.value0);
        }
        ;
        return false;
      };
    }
  };
};
var applyMaybe = {
  apply: function(v) {
    return function(v1) {
      if (v instanceof Just) {
        return map2(v.value0)(v1);
      }
      ;
      if (v instanceof Nothing) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at Data.Maybe (line 67, column 1 - line 69, column 30): " + [v.constructor.name, v1.constructor.name]);
    };
  },
  Functor0: function() {
    return functorMaybe;
  }
};
var bindMaybe = {
  bind: function(v) {
    return function(v1) {
      if (v instanceof Just) {
        return v1(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at Data.Maybe (line 125, column 1 - line 127, column 28): " + [v.constructor.name, v1.constructor.name]);
    };
  },
  Apply0: function() {
    return applyMaybe;
  }
};
var applicativeMaybe = /* @__PURE__ */ (function() {
  return {
    pure: Just.create,
    Apply0: function() {
      return applyMaybe;
    }
  };
})();

// output/Data.Either/index.js
var Left = /* @__PURE__ */ (function() {
  function Left2(value0) {
    this.value0 = value0;
  }
  ;
  Left2.create = function(value0) {
    return new Left2(value0);
  };
  return Left2;
})();
var Right = /* @__PURE__ */ (function() {
  function Right2(value0) {
    this.value0 = value0;
  }
  ;
  Right2.create = function(value0) {
    return new Right2(value0);
  };
  return Right2;
})();
var note = function(a) {
  return maybe(new Left(a))(Right.create);
};
var functorEither = {
  map: function(f) {
    return function(m) {
      if (m instanceof Left) {
        return new Left(m.value0);
      }
      ;
      if (m instanceof Right) {
        return new Right(f(m.value0));
      }
      ;
      throw new Error("Failed pattern match at Data.Either (line 0, column 0 - line 0, column 0): " + [m.constructor.name]);
    };
  }
};
var map3 = /* @__PURE__ */ map(functorEither);
var either = function(v) {
  return function(v1) {
    return function(v2) {
      if (v2 instanceof Left) {
        return v(v2.value0);
      }
      ;
      if (v2 instanceof Right) {
        return v1(v2.value0);
      }
      ;
      throw new Error("Failed pattern match at Data.Either (line 208, column 1 - line 208, column 64): " + [v.constructor.name, v1.constructor.name, v2.constructor.name]);
    };
  };
};
var applyEither = {
  apply: function(v) {
    return function(v1) {
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        return map3(v.value0)(v1);
      }
      ;
      throw new Error("Failed pattern match at Data.Either (line 70, column 1 - line 72, column 30): " + [v.constructor.name, v1.constructor.name]);
    };
  },
  Functor0: function() {
    return functorEither;
  }
};
var bindEither = {
  bind: /* @__PURE__ */ either(function(e) {
    return function(v) {
      return new Left(e);
    };
  })(function(a) {
    return function(f) {
      return f(a);
    };
  }),
  Apply0: function() {
    return applyEither;
  }
};
var applicativeEither = /* @__PURE__ */ (function() {
  return {
    pure: Right.create,
    Apply0: function() {
      return applyEither;
    }
  };
})();
var monadEither = {
  Applicative0: function() {
    return applicativeEither;
  },
  Bind1: function() {
    return bindEither;
  }
};

// output/Data.EuclideanRing/foreign.js
var intDegree = function(x) {
  return Math.min(Math.abs(x), 2147483647);
};
var intDiv = function(x) {
  return function(y) {
    if (y === 0) return 0;
    return y > 0 ? Math.floor(x / y) : -Math.floor(x / -y);
  };
};
var intMod = function(x) {
  return function(y) {
    if (y === 0) return 0;
    var yy = Math.abs(y);
    return (x % yy + yy) % yy;
  };
};
var numDiv = function(n1) {
  return function(n2) {
    return n1 / n2;
  };
};

// output/Data.CommutativeRing/index.js
var commutativeRingNumber = {
  Ring0: function() {
    return ringNumber;
  }
};
var commutativeRingInt = {
  Ring0: function() {
    return ringInt;
  }
};

// output/Data.EuclideanRing/index.js
var mod = function(dict) {
  return dict.mod;
};
var euclideanRingNumber = {
  degree: function(v) {
    return 1;
  },
  div: numDiv,
  mod: function(v) {
    return function(v1) {
      return 0;
    };
  },
  CommutativeRing0: function() {
    return commutativeRingNumber;
  }
};
var euclideanRingInt = {
  degree: intDegree,
  div: intDiv,
  mod: intMod,
  CommutativeRing0: function() {
    return commutativeRingInt;
  }
};
var div = function(dict) {
  return dict.div;
};

// output/Data.Monoid/index.js
var mod2 = /* @__PURE__ */ mod(euclideanRingInt);
var div2 = /* @__PURE__ */ div(euclideanRingInt);
var monoidString = {
  mempty: "",
  Semigroup0: function() {
    return semigroupString;
  }
};
var monoidArray = {
  mempty: [],
  Semigroup0: function() {
    return semigroupArray;
  }
};
var mempty = function(dict) {
  return dict.mempty;
};
var power = function(dictMonoid) {
  var mempty1 = mempty(dictMonoid);
  var append11 = append(dictMonoid.Semigroup0());
  return function(x) {
    var go = function(p) {
      if (p <= 0) {
        return mempty1;
      }
      ;
      if (p === 1) {
        return x;
      }
      ;
      if (mod2(p)(2) === 0) {
        var x$prime = go(div2(p)(2));
        return append11(x$prime)(x$prime);
      }
      ;
      if (otherwise) {
        var x$prime = go(div2(p)(2));
        return append11(x$prime)(append11(x$prime)(x));
      }
      ;
      throw new Error("Failed pattern match at Data.Monoid (line 88, column 3 - line 88, column 17): " + [p.constructor.name]);
    };
    return go;
  };
};

// output/Control.Monad.ST.Internal/foreign.js
var map_ = function(f) {
  return function(a) {
    return function() {
      return f(a());
    };
  };
};
var pure_ = function(a) {
  return function() {
    return a;
  };
};
var bind_ = function(a) {
  return function(f) {
    return function() {
      return f(a())();
    };
  };
};
var foreach = function(as) {
  return function(f) {
    return function() {
      for (var i = 0, l = as.length; i < l; i++) {
        f(as[i])();
      }
    };
  };
};

// output/Control.Monad.ST.Internal/index.js
var $runtime_lazy = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var functorST = {
  map: map_
};
var monadST = {
  Applicative0: function() {
    return applicativeST;
  },
  Bind1: function() {
    return bindST;
  }
};
var bindST = {
  bind: bind_,
  Apply0: function() {
    return $lazy_applyST(0);
  }
};
var applicativeST = {
  pure: pure_,
  Apply0: function() {
    return $lazy_applyST(0);
  }
};
var $lazy_applyST = /* @__PURE__ */ $runtime_lazy("applyST", "Control.Monad.ST.Internal", function() {
  return {
    apply: ap(monadST),
    Functor0: function() {
      return functorST;
    }
  };
});

// output/Data.Array.ST/foreign.js
function newSTArray() {
  return [];
}
function unsafeFreezeThawImpl(xs) {
  return xs;
}
var unsafeFreezeImpl = unsafeFreezeThawImpl;
var unsafeThawImpl = unsafeFreezeThawImpl;
function copyImpl(xs) {
  return xs.slice();
}
var thawImpl = copyImpl;
var pushImpl = function(a, xs) {
  return xs.push(a);
};

// output/Control.Monad.ST.Uncurried/foreign.js
var runSTFn1 = function runSTFn12(fn) {
  return function(a) {
    return function() {
      return fn(a);
    };
  };
};
var runSTFn2 = function runSTFn22(fn) {
  return function(a) {
    return function(b) {
      return function() {
        return fn(a, b);
      };
    };
  };
};

// output/Data.Array.ST/index.js
var unsafeThaw = /* @__PURE__ */ runSTFn1(unsafeThawImpl);
var unsafeFreeze = /* @__PURE__ */ runSTFn1(unsafeFreezeImpl);
var thaw = /* @__PURE__ */ runSTFn1(thawImpl);
var withArray = function(f) {
  return function(xs) {
    return function __do() {
      var result2 = thaw(xs)();
      f(result2)();
      return unsafeFreeze(result2)();
    };
  };
};
var push = /* @__PURE__ */ runSTFn2(pushImpl);

// output/Data.HeytingAlgebra/foreign.js
var boolConj = function(b1) {
  return function(b2) {
    return b1 && b2;
  };
};
var boolDisj = function(b1) {
  return function(b2) {
    return b1 || b2;
  };
};
var boolNot = function(b) {
  return !b;
};

// output/Data.HeytingAlgebra/index.js
var not = function(dict) {
  return dict.not;
};
var ff = function(dict) {
  return dict.ff;
};
var disj = function(dict) {
  return dict.disj;
};
var heytingAlgebraBoolean = {
  ff: false,
  tt: true,
  implies: function(a) {
    return function(b) {
      return disj(heytingAlgebraBoolean)(not(heytingAlgebraBoolean)(a))(b);
    };
  },
  conj: boolConj,
  disj: boolDisj,
  not: boolNot
};

// output/Data.Foldable/foreign.js
var foldrArray = function(f) {
  return function(init2) {
    return function(xs) {
      var acc = init2;
      var len = xs.length;
      for (var i = len - 1; i >= 0; i--) {
        acc = f(xs[i])(acc);
      }
      return acc;
    };
  };
};
var foldlArray = function(f) {
  return function(init2) {
    return function(xs) {
      var acc = init2;
      var len = xs.length;
      for (var i = 0; i < len; i++) {
        acc = f(acc)(xs[i]);
      }
      return acc;
    };
  };
};

// output/Data.Tuple/index.js
var Tuple = /* @__PURE__ */ (function() {
  function Tuple2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  Tuple2.create = function(value0) {
    return function(value1) {
      return new Tuple2(value0, value1);
    };
  };
  return Tuple2;
})();
var uncurry = function(f) {
  return function(v) {
    return f(v.value0)(v.value1);
  };
};
var snd = function(v) {
  return v.value1;
};
var fst = function(v) {
  return v.value0;
};
var eqTuple = function(dictEq) {
  var eq8 = eq(dictEq);
  return function(dictEq1) {
    var eq111 = eq(dictEq1);
    return {
      eq: function(x) {
        return function(y) {
          return eq8(x.value0)(y.value0) && eq111(x.value1)(y.value1);
        };
      }
    };
  };
};

// output/Data.Bifunctor/index.js
var identity5 = /* @__PURE__ */ identity(categoryFn);
var bimap = function(dict) {
  return dict.bimap;
};
var lmap = function(dictBifunctor) {
  var bimap1 = bimap(dictBifunctor);
  return function(f) {
    return bimap1(f)(identity5);
  };
};
var bifunctorEither = {
  bimap: function(v) {
    return function(v1) {
      return function(v2) {
        if (v2 instanceof Left) {
          return new Left(v(v2.value0));
        }
        ;
        if (v2 instanceof Right) {
          return new Right(v1(v2.value0));
        }
        ;
        throw new Error("Failed pattern match at Data.Bifunctor (line 32, column 1 - line 34, column 36): " + [v.constructor.name, v1.constructor.name, v2.constructor.name]);
      };
    };
  }
};

// output/Data.Maybe.First/index.js
var semigroupFirst = {
  append: function(v) {
    return function(v1) {
      if (v instanceof Just) {
        return v;
      }
      ;
      return v1;
    };
  }
};
var monoidFirst = /* @__PURE__ */ (function() {
  return {
    mempty: Nothing.value,
    Semigroup0: function() {
      return semigroupFirst;
    }
  };
})();

// output/Data.Monoid.Disj/index.js
var Disj = function(x) {
  return x;
};
var semigroupDisj = function(dictHeytingAlgebra) {
  var disj2 = disj(dictHeytingAlgebra);
  return {
    append: function(v) {
      return function(v1) {
        return disj2(v)(v1);
      };
    }
  };
};
var monoidDisj = function(dictHeytingAlgebra) {
  var semigroupDisj1 = semigroupDisj(dictHeytingAlgebra);
  return {
    mempty: ff(dictHeytingAlgebra),
    Semigroup0: function() {
      return semigroupDisj1;
    }
  };
};

// output/Unsafe.Coerce/foreign.js
var unsafeCoerce2 = function(x) {
  return x;
};

// output/Safe.Coerce/index.js
var coerce = function() {
  return unsafeCoerce2;
};

// output/Data.Newtype/index.js
var coerce2 = /* @__PURE__ */ coerce();
var unwrap = function() {
  return coerce2;
};
var alaF = function() {
  return function() {
    return function() {
      return function() {
        return function(v) {
          return coerce2;
        };
      };
    };
  };
};

// output/Data.Foldable/index.js
var identity6 = /* @__PURE__ */ identity(categoryFn);
var unwrap2 = /* @__PURE__ */ unwrap();
var alaF2 = /* @__PURE__ */ alaF()()()();
var foldr = function(dict) {
  return dict.foldr;
};
var traverse_ = function(dictApplicative) {
  var applySecond2 = applySecond(dictApplicative.Apply0());
  var pure19 = pure(dictApplicative);
  return function(dictFoldable) {
    var foldr22 = foldr(dictFoldable);
    return function(f) {
      return foldr22(function($454) {
        return applySecond2(f($454));
      })(pure19(unit));
    };
  };
};
var for_ = function(dictApplicative) {
  var traverse_1 = traverse_(dictApplicative);
  return function(dictFoldable) {
    return flip(traverse_1(dictFoldable));
  };
};
var foldl = function(dict) {
  return dict.foldl;
};
var foldableMaybe = {
  foldr: function(v) {
    return function(v1) {
      return function(v2) {
        if (v2 instanceof Nothing) {
          return v1;
        }
        ;
        if (v2 instanceof Just) {
          return v(v2.value0)(v1);
        }
        ;
        throw new Error("Failed pattern match at Data.Foldable (line 138, column 1 - line 144, column 27): " + [v.constructor.name, v1.constructor.name, v2.constructor.name]);
      };
    };
  },
  foldl: function(v) {
    return function(v1) {
      return function(v2) {
        if (v2 instanceof Nothing) {
          return v1;
        }
        ;
        if (v2 instanceof Just) {
          return v(v1)(v2.value0);
        }
        ;
        throw new Error("Failed pattern match at Data.Foldable (line 138, column 1 - line 144, column 27): " + [v.constructor.name, v1.constructor.name, v2.constructor.name]);
      };
    };
  },
  foldMap: function(dictMonoid) {
    var mempty2 = mempty(dictMonoid);
    return function(v) {
      return function(v1) {
        if (v1 instanceof Nothing) {
          return mempty2;
        }
        ;
        if (v1 instanceof Just) {
          return v(v1.value0);
        }
        ;
        throw new Error("Failed pattern match at Data.Foldable (line 138, column 1 - line 144, column 27): " + [v.constructor.name, v1.constructor.name]);
      };
    };
  }
};
var foldMapDefaultR = function(dictFoldable) {
  var foldr22 = foldr(dictFoldable);
  return function(dictMonoid) {
    var append11 = append(dictMonoid.Semigroup0());
    var mempty2 = mempty(dictMonoid);
    return function(f) {
      return foldr22(function(x) {
        return function(acc) {
          return append11(f(x))(acc);
        };
      })(mempty2);
    };
  };
};
var foldableArray = {
  foldr: foldrArray,
  foldl: foldlArray,
  foldMap: function(dictMonoid) {
    return foldMapDefaultR(foldableArray)(dictMonoid);
  }
};
var foldMap = function(dict) {
  return dict.foldMap;
};
var lookup = function(dictFoldable) {
  var foldMap22 = foldMap(dictFoldable)(monoidFirst);
  return function(dictEq) {
    var eq25 = eq(dictEq);
    return function(a) {
      var $460 = foldMap22(function(v) {
        var $444 = eq25(a)(v.value0);
        if ($444) {
          return new Just(v.value1);
        }
        ;
        return Nothing.value;
      });
      return function($461) {
        return unwrap2($460($461));
      };
    };
  };
};
var fold = function(dictFoldable) {
  var foldMap22 = foldMap(dictFoldable);
  return function(dictMonoid) {
    return foldMap22(dictMonoid)(identity6);
  };
};
var any = function(dictFoldable) {
  var foldMap22 = foldMap(dictFoldable);
  return function(dictHeytingAlgebra) {
    return alaF2(Disj)(foldMap22(monoidDisj(dictHeytingAlgebra)));
  };
};
var elem = function(dictFoldable) {
  var any1 = any(dictFoldable)(heytingAlgebraBoolean);
  return function(dictEq) {
    var $462 = eq(dictEq);
    return function($463) {
      return any1($462($463));
    };
  };
};

// output/Data.Function.Uncurried/foreign.js
var runFn2 = function(fn) {
  return function(a) {
    return function(b) {
      return fn(a, b);
    };
  };
};
var runFn3 = function(fn) {
  return function(a) {
    return function(b) {
      return function(c) {
        return fn(a, b, c);
      };
    };
  };
};
var runFn4 = function(fn) {
  return function(a) {
    return function(b) {
      return function(c) {
        return function(d) {
          return fn(a, b, c, d);
        };
      };
    };
  };
};

// output/Data.FunctorWithIndex/foreign.js
var mapWithIndexArray = function(f) {
  return function(xs) {
    var l = xs.length;
    var result2 = Array(l);
    for (var i = 0; i < l; i++) {
      result2[i] = f(i)(xs[i]);
    }
    return result2;
  };
};

// output/Data.FunctorWithIndex/index.js
var mapWithIndex = function(dict) {
  return dict.mapWithIndex;
};
var functorWithIndexArray = {
  mapWithIndex: mapWithIndexArray,
  Functor0: function() {
    return functorArray;
  }
};

// output/Data.Traversable/foreign.js
var traverseArrayImpl = /* @__PURE__ */ (function() {
  function array1(a) {
    return [a];
  }
  function array2(a) {
    return function(b) {
      return [a, b];
    };
  }
  function array3(a) {
    return function(b) {
      return function(c) {
        return [a, b, c];
      };
    };
  }
  function concat2(xs) {
    return function(ys) {
      return xs.concat(ys);
    };
  }
  return function(apply4) {
    return function(map37) {
      return function(pure19) {
        return function(f) {
          return function(array) {
            function go(bot, top3) {
              switch (top3 - bot) {
                case 0:
                  return pure19([]);
                case 1:
                  return map37(array1)(f(array[bot]));
                case 2:
                  return apply4(map37(array2)(f(array[bot])))(f(array[bot + 1]));
                case 3:
                  return apply4(apply4(map37(array3)(f(array[bot])))(f(array[bot + 1])))(f(array[bot + 2]));
                default:
                  var pivot = bot + Math.floor((top3 - bot) / 4) * 2;
                  return apply4(map37(concat2)(go(bot, pivot)))(go(pivot, top3));
              }
            }
            return go(0, array.length);
          };
        };
      };
    };
  };
})();

// output/Data.Traversable.Accum.Internal/index.js
var stateL = function(v) {
  return v;
};
var functorStateL = {
  map: function(f) {
    return function(k) {
      return function(s) {
        var v = stateL(k)(s);
        return {
          accum: v.accum,
          value: f(v.value)
        };
      };
    };
  }
};
var applyStateL = {
  apply: function(f) {
    return function(x) {
      return function(s) {
        var v = stateL(f)(s);
        var v1 = stateL(x)(v.accum);
        return {
          accum: v1.accum,
          value: v.value(v1.value)
        };
      };
    };
  },
  Functor0: function() {
    return functorStateL;
  }
};
var applicativeStateL = {
  pure: function(a) {
    return function(s) {
      return {
        accum: s,
        value: a
      };
    };
  },
  Apply0: function() {
    return applyStateL;
  }
};

// output/Data.Traversable/index.js
var identity7 = /* @__PURE__ */ identity(categoryFn);
var traverse = function(dict) {
  return dict.traverse;
};
var traversableMaybe = {
  traverse: function(dictApplicative) {
    var pure19 = pure(dictApplicative);
    var map37 = map(dictApplicative.Apply0().Functor0());
    return function(v) {
      return function(v1) {
        if (v1 instanceof Nothing) {
          return pure19(Nothing.value);
        }
        ;
        if (v1 instanceof Just) {
          return map37(Just.create)(v(v1.value0));
        }
        ;
        throw new Error("Failed pattern match at Data.Traversable (line 115, column 1 - line 119, column 33): " + [v.constructor.name, v1.constructor.name]);
      };
    };
  },
  sequence: function(dictApplicative) {
    var pure19 = pure(dictApplicative);
    var map37 = map(dictApplicative.Apply0().Functor0());
    return function(v) {
      if (v instanceof Nothing) {
        return pure19(Nothing.value);
      }
      ;
      if (v instanceof Just) {
        return map37(Just.create)(v.value0);
      }
      ;
      throw new Error("Failed pattern match at Data.Traversable (line 115, column 1 - line 119, column 33): " + [v.constructor.name]);
    };
  },
  Functor0: function() {
    return functorMaybe;
  },
  Foldable1: function() {
    return foldableMaybe;
  }
};
var sequenceDefault = function(dictTraversable) {
  var traverse22 = traverse(dictTraversable);
  return function(dictApplicative) {
    return traverse22(dictApplicative)(identity7);
  };
};
var traversableArray = {
  traverse: function(dictApplicative) {
    var Apply0 = dictApplicative.Apply0();
    return traverseArrayImpl(apply(Apply0))(map(Apply0.Functor0()))(pure(dictApplicative));
  },
  sequence: function(dictApplicative) {
    return sequenceDefault(traversableArray)(dictApplicative);
  },
  Functor0: function() {
    return functorArray;
  },
  Foldable1: function() {
    return foldableArray;
  }
};
var mapAccumL = function(dictTraversable) {
  var traverse22 = traverse(dictTraversable)(applicativeStateL);
  return function(f) {
    return function(s0) {
      return function(xs) {
        return stateL(traverse22(function(a) {
          return function(s) {
            return f(s)(a);
          };
        })(xs))(s0);
      };
    };
  };
};

// output/Data.Unfoldable/foreign.js
var unfoldrArrayImpl = function(isNothing2) {
  return function(fromJust6) {
    return function(fst2) {
      return function(snd2) {
        return function(f) {
          return function(b) {
            var result2 = [];
            var value = b;
            while (true) {
              var maybe2 = f(value);
              if (isNothing2(maybe2)) return result2;
              var tuple = fromJust6(maybe2);
              result2.push(fst2(tuple));
              value = snd2(tuple);
            }
          };
        };
      };
    };
  };
};

// output/Data.Unfoldable1/foreign.js
var unfoldr1ArrayImpl = function(isNothing2) {
  return function(fromJust6) {
    return function(fst2) {
      return function(snd2) {
        return function(f) {
          return function(b) {
            var result2 = [];
            var value = b;
            while (true) {
              var tuple = f(value);
              result2.push(fst2(tuple));
              var maybe2 = snd2(tuple);
              if (isNothing2(maybe2)) return result2;
              value = fromJust6(maybe2);
            }
          };
        };
      };
    };
  };
};

// output/Data.Unfoldable1/index.js
var fromJust2 = /* @__PURE__ */ fromJust();
var unfoldable1Array = {
  unfoldr1: /* @__PURE__ */ unfoldr1ArrayImpl(isNothing)(fromJust2)(fst)(snd)
};

// output/Data.Unfoldable/index.js
var fromJust3 = /* @__PURE__ */ fromJust();
var unfoldr = function(dict) {
  return dict.unfoldr;
};
var unfoldableArray = {
  unfoldr: /* @__PURE__ */ unfoldrArrayImpl(isNothing)(fromJust3)(fst)(snd),
  Unfoldable10: function() {
    return unfoldable1Array;
  }
};

// output/Data.Array/index.js
var $$void2 = /* @__PURE__ */ $$void(functorST);
var apply2 = /* @__PURE__ */ apply(applyMaybe);
var map4 = /* @__PURE__ */ map(functorMaybe);
var map1 = /* @__PURE__ */ map(functorArray);
var map22 = /* @__PURE__ */ map(functorST);
var fromJust4 = /* @__PURE__ */ fromJust();
var when2 = /* @__PURE__ */ when(applicativeST);
var notEq2 = /* @__PURE__ */ notEq(eqOrdering);
var append2 = /* @__PURE__ */ append(semigroupArray);
var zipWith = /* @__PURE__ */ runFn3(zipWithImpl);
var unsafeIndex = function() {
  return runFn2(unsafeIndexImpl);
};
var unsafeIndex1 = /* @__PURE__ */ unsafeIndex();
var uncons = /* @__PURE__ */ (function() {
  return runFn3(unconsImpl)($$const(Nothing.value))(function(x) {
    return function(xs) {
      return new Just({
        head: x,
        tail: xs
      });
    };
  });
})();
var toUnfoldable = function(dictUnfoldable) {
  var unfoldr3 = unfoldr(dictUnfoldable);
  return function(xs) {
    var len = length(xs);
    var f = function(i) {
      if (i < len) {
        return new Just(new Tuple(unsafeIndex1(xs)(i), i + 1 | 0));
      }
      ;
      if (otherwise) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at Data.Array (line 163, column 3 - line 165, column 26): " + [i.constructor.name]);
    };
    return unfoldr3(f)(0);
  };
};
var tail = /* @__PURE__ */ (function() {
  return runFn3(unconsImpl)($$const(Nothing.value))(function(v) {
    return function(xs) {
      return new Just(xs);
    };
  });
})();
var sortBy = function(comp) {
  return runFn3(sortByImpl)(comp)(function(v) {
    if (v instanceof GT) {
      return 1;
    }
    ;
    if (v instanceof EQ) {
      return 0;
    }
    ;
    if (v instanceof LT) {
      return -1 | 0;
    }
    ;
    throw new Error("Failed pattern match at Data.Array (line 897, column 38 - line 900, column 11): " + [v.constructor.name]);
  });
};
var sortWith = function(dictOrd) {
  var comparing2 = comparing(dictOrd);
  return function(f) {
    return sortBy(comparing2(f));
  };
};
var sortWith1 = /* @__PURE__ */ sortWith(ordInt);
var snoc = function(xs) {
  return function(x) {
    return withArray(push(x))(xs)();
  };
};
var slice = /* @__PURE__ */ runFn3(sliceImpl);
var take = function(n) {
  return function(xs) {
    var $152 = n < 1;
    if ($152) {
      return [];
    }
    ;
    return slice(0)(n)(xs);
  };
};
var singleton2 = function(a) {
  return [a];
};
var replicate = /* @__PURE__ */ runFn2(replicateImpl);
var range2 = /* @__PURE__ */ runFn2(rangeImpl);
var $$null = function(xs) {
  return length(xs) === 0;
};
var mapWithIndex2 = /* @__PURE__ */ mapWithIndex(functorWithIndexArray);
var init = function(xs) {
  if ($$null(xs)) {
    return Nothing.value;
  }
  ;
  if (otherwise) {
    return new Just(slice(0)(length(xs) - 1 | 0)(xs));
  }
  ;
  throw new Error("Failed pattern match at Data.Array (line 351, column 1 - line 351, column 45): " + [xs.constructor.name]);
};
var index = /* @__PURE__ */ (function() {
  return runFn4(indexImpl)(Just.create)(Nothing.value);
})();
var last = function(xs) {
  return index(xs)(length(xs) - 1 | 0);
};
var unsnoc = function(xs) {
  return apply2(map4(function(v) {
    return function(v1) {
      return {
        init: v,
        last: v1
      };
    };
  })(init(xs)))(last(xs));
};
var span = function(p) {
  return function(arr2) {
    var go = function($copy_i) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(i) {
        var v = index(arr2)(i);
        if (v instanceof Just) {
          var $156 = p(v.value0);
          if ($156) {
            $copy_i = i + 1 | 0;
            return;
          }
          ;
          $tco_done = true;
          return new Just(i);
        }
        ;
        if (v instanceof Nothing) {
          $tco_done = true;
          return Nothing.value;
        }
        ;
        throw new Error("Failed pattern match at Data.Array (line 1035, column 5 - line 1037, column 25): " + [v.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_i);
      }
      ;
      return $tco_result;
    };
    var breakIndex = go(0);
    if (breakIndex instanceof Just && breakIndex.value0 === 0) {
      return {
        init: [],
        rest: arr2
      };
    }
    ;
    if (breakIndex instanceof Just) {
      return {
        init: slice(0)(breakIndex.value0)(arr2),
        rest: slice(breakIndex.value0)(length(arr2))(arr2)
      };
    }
    ;
    if (breakIndex instanceof Nothing) {
      return {
        init: arr2,
        rest: []
      };
    }
    ;
    throw new Error("Failed pattern match at Data.Array (line 1022, column 3 - line 1028, column 30): " + [breakIndex.constructor.name]);
  };
};
var takeWhile = function(p) {
  return function(xs) {
    return span(p)(xs).init;
  };
};
var head = function(xs) {
  return index(xs)(0);
};
var nubBy = function(comp) {
  return function(xs) {
    var indexedAndSorted = sortBy(function(x) {
      return function(y) {
        return comp(snd(x))(snd(y));
      };
    })(mapWithIndex2(Tuple.create)(xs));
    var v = head(indexedAndSorted);
    if (v instanceof Nothing) {
      return [];
    }
    ;
    if (v instanceof Just) {
      return map1(snd)(sortWith1(fst)((function __do() {
        var result2 = unsafeThaw(singleton2(v.value0))();
        foreach(indexedAndSorted)(function(v1) {
          return function __do2() {
            var lst = map22(/* @__PURE__ */ (function() {
              var $183 = function($185) {
                return fromJust4(last($185));
              };
              return function($184) {
                return snd($183($184));
              };
            })())(unsafeFreeze(result2))();
            return when2(notEq2(comp(lst)(v1.value1))(EQ.value))($$void2(push(v1)(result2)))();
          };
        })();
        return unsafeFreeze(result2)();
      })()));
    }
    ;
    throw new Error("Failed pattern match at Data.Array (line 1115, column 17 - line 1123, column 28): " + [v.constructor.name]);
  };
};
var nub = function(dictOrd) {
  return nubBy(compare(dictOrd));
};
var fromFoldable = function(dictFoldable) {
  return runFn2(fromFoldableImpl)(foldr(dictFoldable));
};
var foldr2 = /* @__PURE__ */ foldr(foldableArray);
var foldl2 = /* @__PURE__ */ foldl(foldableArray);
var foldM = function(dictMonad) {
  var pure1 = pure(dictMonad.Applicative0());
  var bind110 = bind(dictMonad.Bind1());
  return function(f) {
    return function(b) {
      return runFn3(unconsImpl)(function(v) {
        return pure1(b);
      })(function(a) {
        return function(as) {
          return bind110(f(b)(a))(function(b$prime) {
            return foldM(dictMonad)(f)(b$prime)(as);
          });
        };
      });
    };
  };
};
var findMap = /* @__PURE__ */ (function() {
  return runFn4(findMapImpl)(Nothing.value)(isJust);
})();
var findLastIndex = /* @__PURE__ */ (function() {
  return runFn4(findLastIndexImpl)(Just.create)(Nothing.value);
})();
var findIndex = /* @__PURE__ */ (function() {
  return runFn4(findIndexImpl)(Just.create)(Nothing.value);
})();
var find2 = function(f) {
  return function(xs) {
    return map4(unsafeIndex1(xs))(findIndex(f)(xs));
  };
};
var filter = /* @__PURE__ */ runFn2(filterImpl);
var elemIndex = function(dictEq) {
  var eq25 = eq(dictEq);
  return function(x) {
    return findIndex(function(v) {
      return eq25(v)(x);
    });
  };
};
var elem2 = function(dictEq) {
  var elemIndex1 = elemIndex(dictEq);
  return function(a) {
    return function(arr2) {
      return isJust(elemIndex1(a)(arr2));
    };
  };
};
var dropWhile = function(p) {
  return function(xs) {
    return span(p)(xs).rest;
  };
};
var dropEnd = function(n) {
  return function(xs) {
    return take(length(xs) - n | 0)(xs);
  };
};
var drop = function(n) {
  return function(xs) {
    var $173 = n < 1;
    if ($173) {
      return xs;
    }
    ;
    return slice(n)(length(xs))(xs);
  };
};
var takeEnd = function(n) {
  return function(xs) {
    return drop(length(xs) - n | 0)(xs);
  };
};
var cons = function(x) {
  return function(xs) {
    return append2([x])(xs);
  };
};
var concatMap = /* @__PURE__ */ flip(/* @__PURE__ */ bind(bindArray));
var mapMaybe = function(f) {
  return concatMap((function() {
    var $189 = maybe([])(singleton2);
    return function($190) {
      return $189(f($190));
    };
  })());
};
var catMaybes = /* @__PURE__ */ mapMaybe(/* @__PURE__ */ identity(categoryFn));
var any2 = /* @__PURE__ */ runFn2(anyImpl);
var nubByEq = function(eq25) {
  return function(xs) {
    return (function __do() {
      var arr2 = newSTArray();
      foreach(xs)(function(x) {
        return function __do2() {
          var e = map22((function() {
            var $194 = any2(function(v) {
              return eq25(v)(x);
            });
            return function($195) {
              return !$194($195);
            };
          })())(unsafeFreeze(arr2))();
          return when2(e)($$void2(push(x)(arr2)))();
        };
      })();
      return unsafeFreeze(arr2)();
    })();
  };
};
var all2 = /* @__PURE__ */ runFn2(allImpl);

// output/Data.Int/foreign.js
var fromNumberImpl = function(just) {
  return function(nothing) {
    return function(n) {
      return (n | 0) === n ? just(n) : nothing;
    };
  };
};
var toNumber = function(n) {
  return n;
};
var fromStringAsImpl = function(just) {
  return function(nothing) {
    return function(radix) {
      var digits;
      if (radix < 11) {
        digits = "[0-" + (radix - 1).toString() + "]";
      } else if (radix === 11) {
        digits = "[0-9a]";
      } else {
        digits = "[0-9a-" + String.fromCharCode(86 + radix) + "]";
      }
      var pattern = new RegExp("^[\\+\\-]?" + digits + "+$", "i");
      return function(s) {
        if (pattern.test(s)) {
          var i = parseInt(s, radix);
          return (i | 0) === i ? just(i) : nothing;
        } else {
          return nothing;
        }
      };
    };
  };
};
var toStringAs = function(radix) {
  return function(i) {
    return i.toString(radix);
  };
};

// output/Data.Number/foreign.js
var isFiniteImpl = isFinite;
function fromStringImpl(str2, isFinite2, just, nothing) {
  var num = parseFloat(str2);
  if (isFinite2(num)) {
    return just(num);
  } else {
    return nothing;
  }
}
var abs = Math.abs;
var ceil = Math.ceil;
var floor = Math.floor;
var round = Math.round;
var trunc = Math.trunc ? Math.trunc : function(x) {
  return x < 0 ? Math.ceil(x) : Math.floor(x);
};

// output/Data.Number/index.js
var fromString = function(str2) {
  return fromStringImpl(str2, isFiniteImpl, Just.create, Nothing.value);
};

// output/Data.Int/index.js
var top2 = /* @__PURE__ */ top(boundedInt);
var bottom2 = /* @__PURE__ */ bottom(boundedInt);
var hexadecimal = 16;
var fromStringAs = /* @__PURE__ */ (function() {
  return fromStringAsImpl(Just.create)(Nothing.value);
})();
var fromString2 = /* @__PURE__ */ fromStringAs(10);
var fromNumber = /* @__PURE__ */ (function() {
  return fromNumberImpl(Just.create)(Nothing.value);
})();
var unsafeClamp = function(x) {
  if (!isFiniteImpl(x)) {
    return 0;
  }
  ;
  if (x >= toNumber(top2)) {
    return top2;
  }
  ;
  if (x <= toNumber(bottom2)) {
    return bottom2;
  }
  ;
  if (otherwise) {
    return fromMaybe(0)(fromNumber(x));
  }
  ;
  throw new Error("Failed pattern match at Data.Int (line 72, column 1 - line 72, column 29): " + [x.constructor.name]);
};
var round2 = function($37) {
  return unsafeClamp(round($37));
};

// output/Data.FoldableWithIndex/index.js
var foldrWithIndex = function(dict) {
  return dict.foldrWithIndex;
};

// output/Data.List.Types/index.js
var Nil = /* @__PURE__ */ (function() {
  function Nil2() {
  }
  ;
  Nil2.value = new Nil2();
  return Nil2;
})();
var Cons = /* @__PURE__ */ (function() {
  function Cons2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  Cons2.create = function(value0) {
    return function(value1) {
      return new Cons2(value0, value1);
    };
  };
  return Cons2;
})();
var foldableList = {
  foldr: function(f) {
    return function(b) {
      var rev = (function() {
        var go = function($copy_v) {
          return function($copy_v1) {
            var $tco_var_v = $copy_v;
            var $tco_done = false;
            var $tco_result;
            function $tco_loop(v, v1) {
              if (v1 instanceof Nil) {
                $tco_done = true;
                return v;
              }
              ;
              if (v1 instanceof Cons) {
                $tco_var_v = new Cons(v1.value0, v);
                $copy_v1 = v1.value1;
                return;
              }
              ;
              throw new Error("Failed pattern match at Data.List.Types (line 107, column 7 - line 107, column 23): " + [v.constructor.name, v1.constructor.name]);
            }
            ;
            while (!$tco_done) {
              $tco_result = $tco_loop($tco_var_v, $copy_v1);
            }
            ;
            return $tco_result;
          };
        };
        return go(Nil.value);
      })();
      var $284 = foldl(foldableList)(flip(f))(b);
      return function($285) {
        return $284(rev($285));
      };
    };
  },
  foldl: function(f) {
    var go = function($copy_b) {
      return function($copy_v) {
        var $tco_var_b = $copy_b;
        var $tco_done1 = false;
        var $tco_result;
        function $tco_loop(b, v) {
          if (v instanceof Nil) {
            $tco_done1 = true;
            return b;
          }
          ;
          if (v instanceof Cons) {
            $tco_var_b = f(b)(v.value0);
            $copy_v = v.value1;
            return;
          }
          ;
          throw new Error("Failed pattern match at Data.List.Types (line 111, column 12 - line 113, column 30): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done1) {
          $tco_result = $tco_loop($tco_var_b, $copy_v);
        }
        ;
        return $tco_result;
      };
    };
    return go;
  },
  foldMap: function(dictMonoid) {
    var append22 = append(dictMonoid.Semigroup0());
    var mempty2 = mempty(dictMonoid);
    return function(f) {
      return foldl(foldableList)(function(acc) {
        var $286 = append22(acc);
        return function($287) {
          return $286(f($287));
        };
      })(mempty2);
    };
  }
};

// output/Data.Map.Internal/index.js
var $runtime_lazy2 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var Leaf = /* @__PURE__ */ (function() {
  function Leaf2() {
  }
  ;
  Leaf2.value = new Leaf2();
  return Leaf2;
})();
var Node = /* @__PURE__ */ (function() {
  function Node2(value0, value1, value2, value3, value4, value5) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
    this.value5 = value5;
  }
  ;
  Node2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return function(value5) {
              return new Node2(value0, value1, value2, value3, value4, value5);
            };
          };
        };
      };
    };
  };
  return Node2;
})();
var IterLeaf = /* @__PURE__ */ (function() {
  function IterLeaf2() {
  }
  ;
  IterLeaf2.value = new IterLeaf2();
  return IterLeaf2;
})();
var IterEmit = /* @__PURE__ */ (function() {
  function IterEmit2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  IterEmit2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new IterEmit2(value0, value1, value2);
      };
    };
  };
  return IterEmit2;
})();
var IterNode = /* @__PURE__ */ (function() {
  function IterNode2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  IterNode2.create = function(value0) {
    return function(value1) {
      return new IterNode2(value0, value1);
    };
  };
  return IterNode2;
})();
var IterDone = /* @__PURE__ */ (function() {
  function IterDone2() {
  }
  ;
  IterDone2.value = new IterDone2();
  return IterDone2;
})();
var IterNext = /* @__PURE__ */ (function() {
  function IterNext2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  IterNext2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new IterNext2(value0, value1, value2);
      };
    };
  };
  return IterNext2;
})();
var Split = /* @__PURE__ */ (function() {
  function Split2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  Split2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new Split2(value0, value1, value2);
      };
    };
  };
  return Split2;
})();
var SplitLast = /* @__PURE__ */ (function() {
  function SplitLast2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  SplitLast2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new SplitLast2(value0, value1, value2);
      };
    };
  };
  return SplitLast2;
})();
var unsafeNode = function(k, v, l, r) {
  if (l instanceof Leaf) {
    if (r instanceof Leaf) {
      return new Node(1, 1, k, v, l, r);
    }
    ;
    if (r instanceof Node) {
      return new Node(1 + r.value0 | 0, 1 + r.value1 | 0, k, v, l, r);
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 702, column 5 - line 706, column 39): " + [r.constructor.name]);
  }
  ;
  if (l instanceof Node) {
    if (r instanceof Leaf) {
      return new Node(1 + l.value0 | 0, 1 + l.value1 | 0, k, v, l, r);
    }
    ;
    if (r instanceof Node) {
      return new Node(1 + (function() {
        var $280 = l.value0 > r.value0;
        if ($280) {
          return l.value0;
        }
        ;
        return r.value0;
      })() | 0, (1 + l.value1 | 0) + r.value1 | 0, k, v, l, r);
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 708, column 5 - line 712, column 68): " + [r.constructor.name]);
  }
  ;
  throw new Error("Failed pattern match at Data.Map.Internal (line 700, column 32 - line 712, column 68): " + [l.constructor.name]);
};
var toMapIter = /* @__PURE__ */ (function() {
  return flip(IterNode.create)(IterLeaf.value);
})();
var stepWith = function(f) {
  return function(next) {
    return function(done) {
      var go = function($copy_v) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(v) {
          if (v instanceof IterLeaf) {
            $tco_done = true;
            return done(unit);
          }
          ;
          if (v instanceof IterEmit) {
            $tco_done = true;
            return next(v.value0, v.value1, v.value2);
          }
          ;
          if (v instanceof IterNode) {
            $copy_v = f(v.value1)(v.value0);
            return;
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 940, column 8 - line 946, column 20): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_v);
        }
        ;
        return $tco_result;
      };
      return go;
    };
  };
};
var size = function(v) {
  if (v instanceof Leaf) {
    return 0;
  }
  ;
  if (v instanceof Node) {
    return v.value1;
  }
  ;
  throw new Error("Failed pattern match at Data.Map.Internal (line 618, column 8 - line 620, column 24): " + [v.constructor.name]);
};
var singleton4 = function(k) {
  return function(v) {
    return new Node(1, 1, k, v, Leaf.value, Leaf.value);
  };
};
var unsafeBalancedNode = /* @__PURE__ */ (function() {
  var height = function(v) {
    if (v instanceof Leaf) {
      return 0;
    }
    ;
    if (v instanceof Node) {
      return v.value0;
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 757, column 12 - line 759, column 26): " + [v.constructor.name]);
  };
  var rotateLeft = function(k, v, l, rk, rv, rl, rr) {
    if (rl instanceof Node && rl.value0 > height(rr)) {
      return unsafeNode(rl.value2, rl.value3, unsafeNode(k, v, l, rl.value4), unsafeNode(rk, rv, rl.value5, rr));
    }
    ;
    return unsafeNode(rk, rv, unsafeNode(k, v, l, rl), rr);
  };
  var rotateRight = function(k, v, lk, lv, ll, lr, r) {
    if (lr instanceof Node && height(ll) <= lr.value0) {
      return unsafeNode(lr.value2, lr.value3, unsafeNode(lk, lv, ll, lr.value4), unsafeNode(k, v, lr.value5, r));
    }
    ;
    return unsafeNode(lk, lv, ll, unsafeNode(k, v, lr, r));
  };
  return function(k, v, l, r) {
    if (l instanceof Leaf) {
      if (r instanceof Leaf) {
        return singleton4(k)(v);
      }
      ;
      if (r instanceof Node && r.value0 > 1) {
        return rotateLeft(k, v, l, r.value2, r.value3, r.value4, r.value5);
      }
      ;
      return unsafeNode(k, v, l, r);
    }
    ;
    if (l instanceof Node) {
      if (r instanceof Node) {
        if (r.value0 > (l.value0 + 1 | 0)) {
          return rotateLeft(k, v, l, r.value2, r.value3, r.value4, r.value5);
        }
        ;
        if (l.value0 > (r.value0 + 1 | 0)) {
          return rotateRight(k, v, l.value2, l.value3, l.value4, l.value5, r);
        }
        ;
      }
      ;
      if (r instanceof Leaf && l.value0 > 1) {
        return rotateRight(k, v, l.value2, l.value3, l.value4, l.value5, r);
      }
      ;
      return unsafeNode(k, v, l, r);
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 717, column 40 - line 738, column 34): " + [l.constructor.name]);
  };
})();
var $lazy_unsafeSplit = /* @__PURE__ */ $runtime_lazy2("unsafeSplit", "Data.Map.Internal", function() {
  return function(comp, k, m) {
    if (m instanceof Leaf) {
      return new Split(Nothing.value, Leaf.value, Leaf.value);
    }
    ;
    if (m instanceof Node) {
      var v = comp(k)(m.value2);
      if (v instanceof LT) {
        var v1 = $lazy_unsafeSplit(793)(comp, k, m.value4);
        return new Split(v1.value0, v1.value1, unsafeBalancedNode(m.value2, m.value3, v1.value2, m.value5));
      }
      ;
      if (v instanceof GT) {
        var v1 = $lazy_unsafeSplit(796)(comp, k, m.value5);
        return new Split(v1.value0, unsafeBalancedNode(m.value2, m.value3, m.value4, v1.value1), v1.value2);
      }
      ;
      if (v instanceof EQ) {
        return new Split(new Just(m.value3), m.value4, m.value5);
      }
      ;
      throw new Error("Failed pattern match at Data.Map.Internal (line 791, column 5 - line 799, column 30): " + [v.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 787, column 34 - line 799, column 30): " + [m.constructor.name]);
  };
});
var unsafeSplit = /* @__PURE__ */ $lazy_unsafeSplit(786);
var $lazy_unsafeSplitLast = /* @__PURE__ */ $runtime_lazy2("unsafeSplitLast", "Data.Map.Internal", function() {
  return function(k, v, l, r) {
    if (r instanceof Leaf) {
      return new SplitLast(k, v, l);
    }
    ;
    if (r instanceof Node) {
      var v1 = $lazy_unsafeSplitLast(779)(r.value2, r.value3, r.value4, r.value5);
      return new SplitLast(v1.value0, v1.value1, unsafeBalancedNode(k, v, l, v1.value2));
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 776, column 37 - line 780, column 57): " + [r.constructor.name]);
  };
});
var unsafeSplitLast = /* @__PURE__ */ $lazy_unsafeSplitLast(775);
var unsafeJoinNodes = function(v, v1) {
  if (v instanceof Leaf) {
    return v1;
  }
  ;
  if (v instanceof Node) {
    var v2 = unsafeSplitLast(v.value2, v.value3, v.value4, v.value5);
    return unsafeBalancedNode(v2.value0, v2.value1, v2.value2, v1);
  }
  ;
  throw new Error("Failed pattern match at Data.Map.Internal (line 764, column 25 - line 768, column 38): " + [v.constructor.name, v1.constructor.name]);
};
var $lazy_unsafeUnionWith = /* @__PURE__ */ $runtime_lazy2("unsafeUnionWith", "Data.Map.Internal", function() {
  return function(comp, app, l, r) {
    if (l instanceof Leaf) {
      return r;
    }
    ;
    if (r instanceof Leaf) {
      return l;
    }
    ;
    if (r instanceof Node) {
      var v = unsafeSplit(comp, r.value2, l);
      var l$prime = $lazy_unsafeUnionWith(809)(comp, app, v.value1, r.value4);
      var r$prime = $lazy_unsafeUnionWith(810)(comp, app, v.value2, r.value5);
      if (v.value0 instanceof Just) {
        return unsafeBalancedNode(r.value2, app(v.value0.value0)(r.value3), l$prime, r$prime);
      }
      ;
      if (v.value0 instanceof Nothing) {
        return unsafeBalancedNode(r.value2, r.value3, l$prime, r$prime);
      }
      ;
      throw new Error("Failed pattern match at Data.Map.Internal (line 811, column 5 - line 815, column 46): " + [v.value0.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 804, column 42 - line 815, column 46): " + [l.constructor.name, r.constructor.name]);
  };
});
var unsafeUnionWith = /* @__PURE__ */ $lazy_unsafeUnionWith(803);
var unionWith = function(dictOrd) {
  var compare4 = compare(dictOrd);
  return function(app) {
    return function(m1) {
      return function(m2) {
        return unsafeUnionWith(compare4, app, m1, m2);
      };
    };
  };
};
var union = function(dictOrd) {
  return unionWith(dictOrd)($$const);
};
var member = function(dictOrd) {
  var compare4 = compare(dictOrd);
  return function(k) {
    var go = function($copy_v) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(v) {
        if (v instanceof Leaf) {
          $tco_done = true;
          return false;
        }
        ;
        if (v instanceof Node) {
          var v1 = compare4(k)(v.value2);
          if (v1 instanceof LT) {
            $copy_v = v.value4;
            return;
          }
          ;
          if (v1 instanceof GT) {
            $copy_v = v.value5;
            return;
          }
          ;
          if (v1 instanceof EQ) {
            $tco_done = true;
            return true;
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 459, column 7 - line 462, column 19): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 456, column 8 - line 462, column 19): " + [v.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_v);
      }
      ;
      return $tco_result;
    };
    return go;
  };
};
var lookup2 = function(dictOrd) {
  var compare4 = compare(dictOrd);
  return function(k) {
    var go = function($copy_v) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(v) {
        if (v instanceof Leaf) {
          $tco_done = true;
          return Nothing.value;
        }
        ;
        if (v instanceof Node) {
          var v1 = compare4(k)(v.value2);
          if (v1 instanceof LT) {
            $copy_v = v.value4;
            return;
          }
          ;
          if (v1 instanceof GT) {
            $copy_v = v.value5;
            return;
          }
          ;
          if (v1 instanceof EQ) {
            $tco_done = true;
            return new Just(v.value3);
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 283, column 7 - line 286, column 22): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 280, column 8 - line 286, column 22): " + [v.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_v);
      }
      ;
      return $tco_result;
    };
    return go;
  };
};
var iterMapL = /* @__PURE__ */ (function() {
  var go = function($copy_iter) {
    return function($copy_v) {
      var $tco_var_iter = $copy_iter;
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(iter, v) {
        if (v instanceof Leaf) {
          $tco_done = true;
          return iter;
        }
        ;
        if (v instanceof Node) {
          if (v.value5 instanceof Leaf) {
            $tco_var_iter = new IterEmit(v.value2, v.value3, iter);
            $copy_v = v.value4;
            return;
          }
          ;
          $tco_var_iter = new IterEmit(v.value2, v.value3, new IterNode(v.value5, iter));
          $copy_v = v.value4;
          return;
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 951, column 13 - line 958, column 48): " + [v.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($tco_var_iter, $copy_v);
      }
      ;
      return $tco_result;
    };
  };
  return go;
})();
var stepAscCps = /* @__PURE__ */ stepWith(iterMapL);
var stepAsc = /* @__PURE__ */ (function() {
  return stepAscCps(function(k, v, next) {
    return new IterNext(k, v, next);
  })($$const(IterDone.value));
})();
var eqMapIter = function(dictEq) {
  var eq111 = eq(dictEq);
  return function(dictEq1) {
    var eq25 = eq(dictEq1);
    return {
      eq: /* @__PURE__ */ (function() {
        var go = function($copy_a) {
          return function($copy_b) {
            var $tco_var_a = $copy_a;
            var $tco_done = false;
            var $tco_result;
            function $tco_loop(a, b) {
              var v = stepAsc(a);
              if (v instanceof IterNext) {
                var v2 = stepAsc(b);
                if (v2 instanceof IterNext && (eq111(v.value0)(v2.value0) && eq25(v.value1)(v2.value1))) {
                  $tco_var_a = v.value2;
                  $copy_b = v2.value2;
                  return;
                }
                ;
                $tco_done = true;
                return false;
              }
              ;
              if (v instanceof IterDone) {
                $tco_done = true;
                return true;
              }
              ;
              throw new Error("Failed pattern match at Data.Map.Internal (line 859, column 14 - line 868, column 13): " + [v.constructor.name]);
            }
            ;
            while (!$tco_done) {
              $tco_result = $tco_loop($tco_var_a, $copy_b);
            }
            ;
            return $tco_result;
          };
        };
        return go;
      })()
    };
  };
};
var stepUnfoldr = /* @__PURE__ */ (function() {
  var step2 = function(k, v, next) {
    return new Just(new Tuple(new Tuple(k, v), next));
  };
  return stepAscCps(step2)(function(v) {
    return Nothing.value;
  });
})();
var toUnfoldable2 = function(dictUnfoldable) {
  var $784 = unfoldr(dictUnfoldable)(stepUnfoldr);
  return function($785) {
    return $784(toMapIter($785));
  };
};
var isEmpty = function(v) {
  if (v instanceof Leaf) {
    return true;
  }
  ;
  return false;
};
var insertWith = function(dictOrd) {
  var compare4 = compare(dictOrd);
  return function(app) {
    return function(k) {
      return function(v) {
        var go = function(v1) {
          if (v1 instanceof Leaf) {
            return singleton4(k)(v);
          }
          ;
          if (v1 instanceof Node) {
            var v2 = compare4(k)(v1.value2);
            if (v2 instanceof LT) {
              return unsafeBalancedNode(v1.value2, v1.value3, go(v1.value4), v1.value5);
            }
            ;
            if (v2 instanceof GT) {
              return unsafeBalancedNode(v1.value2, v1.value3, v1.value4, go(v1.value5));
            }
            ;
            if (v2 instanceof EQ) {
              return new Node(v1.value0, v1.value1, k, app(v1.value3)(v), v1.value4, v1.value5);
            }
            ;
            throw new Error("Failed pattern match at Data.Map.Internal (line 486, column 7 - line 489, column 44): " + [v2.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 483, column 8 - line 489, column 44): " + [v1.constructor.name]);
        };
        return go;
      };
    };
  };
};
var insert = function(dictOrd) {
  var compare4 = compare(dictOrd);
  return function(k) {
    return function(v) {
      var go = function(v1) {
        if (v1 instanceof Leaf) {
          return singleton4(k)(v);
        }
        ;
        if (v1 instanceof Node) {
          var v2 = compare4(k)(v1.value2);
          if (v2 instanceof LT) {
            return unsafeBalancedNode(v1.value2, v1.value3, go(v1.value4), v1.value5);
          }
          ;
          if (v2 instanceof GT) {
            return unsafeBalancedNode(v1.value2, v1.value3, v1.value4, go(v1.value5));
          }
          ;
          if (v2 instanceof EQ) {
            return new Node(v1.value0, v1.value1, k, v, v1.value4, v1.value5);
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 471, column 7 - line 474, column 35): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 468, column 8 - line 474, column 35): " + [v1.constructor.name]);
      };
      return go;
    };
  };
};
var functorMap = {
  map: function(f) {
    var go = function(v) {
      if (v instanceof Leaf) {
        return Leaf.value;
      }
      ;
      if (v instanceof Node) {
        return new Node(v.value0, v.value1, v.value2, f(v.value3), go(v.value4), go(v.value5));
      }
      ;
      throw new Error("Failed pattern match at Data.Map.Internal (line 147, column 10 - line 150, column 39): " + [v.constructor.name]);
    };
    return go;
  }
};
var foldableMap = {
  foldr: function(f) {
    return function(z) {
      var $lazy_go = $runtime_lazy2("go", "Data.Map.Internal", function() {
        return function(m$prime, z$prime) {
          if (m$prime instanceof Leaf) {
            return z$prime;
          }
          ;
          if (m$prime instanceof Node) {
            return $lazy_go(172)(m$prime.value4, f(m$prime.value3)($lazy_go(172)(m$prime.value5, z$prime)));
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 169, column 26 - line 172, column 43): " + [m$prime.constructor.name]);
        };
      });
      var go = $lazy_go(169);
      return function(m) {
        return go(m, z);
      };
    };
  },
  foldl: function(f) {
    return function(z) {
      var $lazy_go = $runtime_lazy2("go", "Data.Map.Internal", function() {
        return function(z$prime, m$prime) {
          if (m$prime instanceof Leaf) {
            return z$prime;
          }
          ;
          if (m$prime instanceof Node) {
            return $lazy_go(178)(f($lazy_go(178)(z$prime, m$prime.value4))(m$prime.value3), m$prime.value5);
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 175, column 26 - line 178, column 43): " + [m$prime.constructor.name]);
        };
      });
      var go = $lazy_go(175);
      return function(m) {
        return go(z, m);
      };
    };
  },
  foldMap: function(dictMonoid) {
    var mempty2 = mempty(dictMonoid);
    var append110 = append(dictMonoid.Semigroup0());
    return function(f) {
      var go = function(v) {
        if (v instanceof Leaf) {
          return mempty2;
        }
        ;
        if (v instanceof Node) {
          return append110(go(v.value4))(append110(f(v.value3))(go(v.value5)));
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 181, column 10 - line 184, column 28): " + [v.constructor.name]);
      };
      return go;
    };
  }
};
var foldableWithIndexMap = {
  foldrWithIndex: function(f) {
    return function(z) {
      var $lazy_go = $runtime_lazy2("go", "Data.Map.Internal", function() {
        return function(m$prime, z$prime) {
          if (m$prime instanceof Leaf) {
            return z$prime;
          }
          ;
          if (m$prime instanceof Node) {
            return $lazy_go(192)(m$prime.value4, f(m$prime.value2)(m$prime.value3)($lazy_go(192)(m$prime.value5, z$prime)));
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 189, column 26 - line 192, column 45): " + [m$prime.constructor.name]);
        };
      });
      var go = $lazy_go(189);
      return function(m) {
        return go(m, z);
      };
    };
  },
  foldlWithIndex: function(f) {
    return function(z) {
      var $lazy_go = $runtime_lazy2("go", "Data.Map.Internal", function() {
        return function(z$prime, m$prime) {
          if (m$prime instanceof Leaf) {
            return z$prime;
          }
          ;
          if (m$prime instanceof Node) {
            return $lazy_go(198)(f(m$prime.value2)($lazy_go(198)(z$prime, m$prime.value4))(m$prime.value3), m$prime.value5);
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 195, column 26 - line 198, column 45): " + [m$prime.constructor.name]);
        };
      });
      var go = $lazy_go(195);
      return function(m) {
        return go(z, m);
      };
    };
  },
  foldMapWithIndex: function(dictMonoid) {
    var mempty2 = mempty(dictMonoid);
    var append110 = append(dictMonoid.Semigroup0());
    return function(f) {
      var go = function(v) {
        if (v instanceof Leaf) {
          return mempty2;
        }
        ;
        if (v instanceof Node) {
          return append110(go(v.value4))(append110(f(v.value2)(v.value3))(go(v.value5)));
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 201, column 10 - line 204, column 30): " + [v.constructor.name]);
      };
      return go;
    };
  },
  Foldable0: function() {
    return foldableMap;
  }
};
var keys = /* @__PURE__ */ (function() {
  return foldrWithIndex(foldableWithIndexMap)(function(k) {
    return function(v) {
      return function(acc) {
        return new Cons(k, acc);
      };
    };
  })(Nil.value);
})();
var eqMap = function(dictEq) {
  var eqMapIter1 = eqMapIter(dictEq);
  return function(dictEq1) {
    var eq111 = eq(eqMapIter1(dictEq1));
    return {
      eq: function(xs) {
        return function(ys) {
          if (xs instanceof Leaf) {
            if (ys instanceof Leaf) {
              return true;
            }
            ;
            return false;
          }
          ;
          if (xs instanceof Node) {
            if (ys instanceof Node && xs.value1 === ys.value1) {
              return eq111(toMapIter(xs))(toMapIter(ys));
            }
            ;
            return false;
          }
          ;
          throw new Error("Failed pattern match at Data.Map.Internal (line 94, column 14 - line 105, column 16): " + [xs.constructor.name]);
        };
      }
    };
  };
};
var empty2 = /* @__PURE__ */ (function() {
  return Leaf.value;
})();
var fromFoldable2 = function(dictOrd) {
  var insert12 = insert(dictOrd);
  return function(dictFoldable) {
    return foldl(dictFoldable)(function(m) {
      return function(v) {
        return insert12(v.value0)(v.value1)(m);
      };
    })(empty2);
  };
};
var alter = function(dictOrd) {
  var compare4 = compare(dictOrd);
  return function(f) {
    return function(k) {
      return function(m) {
        var v = unsafeSplit(compare4, k, m);
        var v2 = f(v.value0);
        if (v2 instanceof Nothing) {
          return unsafeJoinNodes(v.value1, v.value2);
        }
        ;
        if (v2 instanceof Just) {
          return unsafeBalancedNode(k, v2.value0, v.value1, v.value2);
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 514, column 3 - line 518, column 41): " + [v2.constructor.name]);
      };
    };
  };
};

// output/Data.String.CodeUnits/foreign.js
var fromCharArray = function(a) {
  return a.join("");
};
var toCharArray = function(s) {
  return s.split("");
};
var singleton5 = function(c) {
  return c;
};
var length2 = function(s) {
  return s.length;
};
var countPrefix = function(p) {
  return function(s) {
    var i = 0;
    while (i < s.length && p(s.charAt(i))) i++;
    return i;
  };
};
var _indexOf = function(just) {
  return function(nothing) {
    return function(x) {
      return function(s) {
        var i = s.indexOf(x);
        return i === -1 ? nothing : just(i);
      };
    };
  };
};
var _lastIndexOf = function(just) {
  return function(nothing) {
    return function(x) {
      return function(s) {
        var i = s.lastIndexOf(x);
        return i === -1 ? nothing : just(i);
      };
    };
  };
};
var take2 = function(n) {
  return function(s) {
    return s.substr(0, n);
  };
};
var drop2 = function(n) {
  return function(s) {
    return s.substring(n);
  };
};
var slice2 = function(b) {
  return function(e) {
    return function(s) {
      return s.slice(b, e);
    };
  };
};
var splitAt = function(i) {
  return function(s) {
    return { before: s.substring(0, i), after: s.substring(i) };
  };
};

// output/Data.String.Unsafe/foreign.js
var charAt = function(i) {
  return function(s) {
    if (i >= 0 && i < s.length) return s.charAt(i);
    throw new Error("Data.String.Unsafe.charAt: Invalid index.");
  };
};

// output/Data.String.CodeUnits/index.js
var uncons2 = function(v) {
  if (v === "") {
    return Nothing.value;
  }
  ;
  return new Just({
    head: charAt(0)(v),
    tail: drop2(1)(v)
  });
};
var takeWhile2 = function(p) {
  return function(s) {
    return take2(countPrefix(p)(s))(s);
  };
};
var takeRight = function(i) {
  return function(s) {
    return drop2(length2(s) - i | 0)(s);
  };
};
var stripSuffix = function(v) {
  return function(str2) {
    var v1 = splitAt(length2(str2) - length2(v) | 0)(str2);
    var $14 = v1.after === v;
    if ($14) {
      return new Just(v1.before);
    }
    ;
    return Nothing.value;
  };
};
var stripPrefix = function(v) {
  return function(str2) {
    var v1 = splitAt(length2(v))(str2);
    var $20 = v1.before === v;
    if ($20) {
      return new Just(v1.after);
    }
    ;
    return Nothing.value;
  };
};
var lastIndexOf = /* @__PURE__ */ (function() {
  return _lastIndexOf(Just.create)(Nothing.value);
})();
var indexOf = /* @__PURE__ */ (function() {
  return _indexOf(Just.create)(Nothing.value);
})();
var dropRight = function(i) {
  return function(s) {
    return take2(length2(s) - i | 0)(s);
  };
};
var contains = function(pat) {
  var $23 = indexOf(pat);
  return function($24) {
    return isJust($23($24));
  };
};

// output/Data.String.Common/foreign.js
var replaceAll = function(s1) {
  return function(s2) {
    return function(s3) {
      return s3.replace(new RegExp(s1.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"), "g"), s2);
    };
  };
};
var split = function(sep) {
  return function(s) {
    return s.split(sep);
  };
};
var toLower = function(s) {
  return s.toLowerCase();
};
var toUpper = function(s) {
  return s.toUpperCase();
};
var trim = function(s) {
  return s.trim();
};
var joinWith = function(s) {
  return function(xs) {
    return xs.join(s);
  };
};

// output/FlatBars.Value/index.js
var eqMap2 = /* @__PURE__ */ eqMap(eqString);
var VString = /* @__PURE__ */ (function() {
  function VString2(value0) {
    this.value0 = value0;
  }
  ;
  VString2.create = function(value0) {
    return new VString2(value0);
  };
  return VString2;
})();
var VNumber = /* @__PURE__ */ (function() {
  function VNumber2(value0) {
    this.value0 = value0;
  }
  ;
  VNumber2.create = function(value0) {
    return new VNumber2(value0);
  };
  return VNumber2;
})();
var VBool = /* @__PURE__ */ (function() {
  function VBool2(value0) {
    this.value0 = value0;
  }
  ;
  VBool2.create = function(value0) {
    return new VBool2(value0);
  };
  return VBool2;
})();
var VNull = /* @__PURE__ */ (function() {
  function VNull2() {
  }
  ;
  VNull2.value = new VNull2();
  return VNull2;
})();
var VArray = /* @__PURE__ */ (function() {
  function VArray2(value0) {
    this.value0 = value0;
  }
  ;
  VArray2.create = function(value0) {
    return new VArray2(value0);
  };
  return VArray2;
})();
var VObject = /* @__PURE__ */ (function() {
  function VObject2(value0) {
    this.value0 = value0;
  }
  ;
  VObject2.create = function(value0) {
    return new VObject2(value0);
  };
  return VObject2;
})();
var VSafe = /* @__PURE__ */ (function() {
  function VSafe2(value0) {
    this.value0 = value0;
  }
  ;
  VSafe2.create = function(value0) {
    return new VSafe2(value0);
  };
  return VSafe2;
})();
var eqValue = {
  eq: function(x) {
    return function(y) {
      if (x instanceof VString && y instanceof VString) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof VNumber && y instanceof VNumber) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof VBool && y instanceof VBool) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof VNull && y instanceof VNull) {
        return true;
      }
      ;
      if (x instanceof VArray && y instanceof VArray) {
        return eq(eqArray(eqValue))(x.value0)(y.value0);
      }
      ;
      if (x instanceof VObject && y instanceof VObject) {
        return eq(eqMap2(eqValue))(x.value0)(y.value0);
      }
      ;
      if (x instanceof VSafe && y instanceof VSafe) {
        return x.value0 === y.value0;
      }
      ;
      return false;
    };
  }
};

// output/FlatBars.Syntax/index.js
var Section = /* @__PURE__ */ (function() {
  function Section2() {
  }
  ;
  Section2.value = new Section2();
  return Section2;
})();
var Inverse = /* @__PURE__ */ (function() {
  function Inverse2() {
  }
  ;
  Inverse2.value = new Inverse2();
  return Inverse2;
})();
var Parent = /* @__PURE__ */ (function() {
  function Parent2() {
  }
  ;
  Parent2.value = new Parent2();
  return Parent2;
})();
var BlockDef = /* @__PURE__ */ (function() {
  function BlockDef2() {
  }
  ;
  BlockDef2.value = new BlockDef2();
  return BlockDef2;
})();
var PartialBlock = /* @__PURE__ */ (function() {
  function PartialBlock2() {
  }
  ;
  PartialBlock2.value = new PartialBlock2();
  return PartialBlock2;
})();
var Decorator = /* @__PURE__ */ (function() {
  function Decorator2() {
  }
  ;
  Decorator2.value = new Decorator2();
  return Decorator2;
})();
var Lit = /* @__PURE__ */ (function() {
  function Lit2(value0) {
    this.value0 = value0;
  }
  ;
  Lit2.create = function(value0) {
    return new Lit2(value0);
  };
  return Lit2;
})();
var App2 = /* @__PURE__ */ (function() {
  function App3(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  App3.create = function(value0) {
    return function(value1) {
      return new App3(value0, value1);
    };
  };
  return App3;
})();
var Content = /* @__PURE__ */ (function() {
  function Content2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  Content2.create = function(value0) {
    return function(value1) {
      return new Content2(value0, value1);
    };
  };
  return Content2;
})();
var Output = /* @__PURE__ */ (function() {
  function Output2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  Output2.create = function(value0) {
    return function(value1) {
      return new Output2(value0, value1);
    };
  };
  return Output2;
})();
var Block = /* @__PURE__ */ (function() {
  function Block2(value0, value1, value2, value3, value4) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
  }
  ;
  Block2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return new Block2(value0, value1, value2, value3, value4);
          };
        };
      };
    };
  };
  return Block2;
})();
var RawBlock = /* @__PURE__ */ (function() {
  function RawBlock2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RawBlock2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RawBlock2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RawBlock2;
})();
var Sep = /* @__PURE__ */ (function() {
  function Sep2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  Sep2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new Sep2(value0, value1, value2);
      };
    };
  };
  return Sep2;
})();
var NodeError = /* @__PURE__ */ (function() {
  function NodeError2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  NodeError2.create = function(value0) {
    return function(value1) {
      return new NodeError2(value0, value1);
    };
  };
  return NodeError2;
})();
var splitBlockArgs = function(args) {
  var demarker = function(v) {
    if (v instanceof App2 && v.value0 === "@label") {
      return Nothing.value;
    }
    ;
    if (v instanceof App2 && v.value0 === "@hash") {
      return new Just(new App2("dict", v.value1));
    }
    ;
    if (v instanceof App2 && (v.value0 === "@param" && (v.value1.length === 1 && (v["value1"][0] instanceof Lit && v["value1"][0].value0 instanceof VString)))) {
      return new Just(new Lit(new VString(v["value1"][0].value0.value0)));
    }
    ;
    return new Just(v);
  };
  var asParam = function(v) {
    if (v instanceof App2 && (v.value0 === "@param" && (v.value1.length === 1 && (v["value1"][0] instanceof Lit && v["value1"][0].value0 instanceof VString)))) {
      return new Just(v["value1"][0].value0.value0);
    }
    ;
    return Nothing.value;
  };
  var asLabel = function(v) {
    if (v instanceof App2 && (v.value0 === "@label" && (v.value1.length === 1 && (v["value1"][0] instanceof Lit && v["value1"][0].value0 instanceof VString)))) {
      return new Just(v["value1"][0].value0.value0);
    }
    ;
    return Nothing.value;
  };
  var asHash = function(v) {
    if (v instanceof App2 && v.value0 === "@hash") {
      return new Just(new App2("dict", v.value1));
    }
    ;
    return Nothing.value;
  };
  return {
    positional: mapMaybe(demarker)(args),
    hash: findMap(asHash)(args),
    params: mapMaybe(asParam)(args),
    label: findMap(asLabel)(args)
  };
};
var eqSigil = {
  eq: function(x) {
    return function(y) {
      if (x instanceof Section && y instanceof Section) {
        return true;
      }
      ;
      if (x instanceof Inverse && y instanceof Inverse) {
        return true;
      }
      ;
      if (x instanceof Parent && y instanceof Parent) {
        return true;
      }
      ;
      if (x instanceof BlockDef && y instanceof BlockDef) {
        return true;
      }
      ;
      if (x instanceof PartialBlock && y instanceof PartialBlock) {
        return true;
      }
      ;
      if (x instanceof Decorator && y instanceof Decorator) {
        return true;
      }
      ;
      return false;
    };
  }
};

// output/ClassicBars.Surface/index.js
var $runtime_lazy3 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var foldl3 = /* @__PURE__ */ foldl(foldableArray);
var map5 = /* @__PURE__ */ map(functorArray);
var append1 = /* @__PURE__ */ append(semigroupArray);
var elem3 = /* @__PURE__ */ elem2(eqString);
var union2 = /* @__PURE__ */ union(ordString);
var insert2 = /* @__PURE__ */ insert(ordString);
var notEq1 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqString));
var lookup3 = /* @__PURE__ */ lookup2(ordString);
var pure2 = /* @__PURE__ */ pure(applicativeArray);
var withReRootViolation = function(nodes) {
  var node2 = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "with")) {
      return new Just({
        off: v.value0.start,
        shape: "{% with \u2026 %} (the context re-root is renamed `scope` \u2014 write {% scope \u2026 %} \u2026 {% endscope %}; `with` is reserved, ADR-039)"
      });
    }
    ;
    if (v instanceof Block) {
      return withReRootViolation(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node2)(nodes));
};
var stripParents = function($copy_s) {
  return function($copy_depth) {
    var $tco_var_s = $copy_s;
    var $tco_done = false;
    var $tco_result;
    function $tco_loop(s, depth) {
      var v = stripPrefix("../")(s);
      if (v instanceof Just) {
        $tco_var_s = v.value0;
        $copy_depth = depth + 1 | 0;
        return;
      }
      ;
      if (v instanceof Nothing) {
        $tco_done = true;
        return {
          depth,
          rest: s
        };
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 814, column 24 - line 816, column 32): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_s, $copy_depth);
    }
    ;
    return $tco_result;
  };
};
var strictSurfaceViolation = function(nodes) {
  var node2 = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
      return new Just({
        off: v.value0.start,
        shape: '{{#inline}} (an inline partial uses the {{#*inline "name"}} decorator)'
      });
    }
    ;
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "local")) {
      return new Just({
        off: v.value0.start,
        shape: "{{#local}} (the bounded binding is a RawBars/MaxBars construct; ClassicBars has no `local` \u2014 alias with {{#with x as |n|}}, or build a constant with (dict \u2026))"
      });
    }
    ;
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "let")) {
      return new Just({
        off: v.value0.start,
        shape: "{{#let}} (`let` is retired \u2014 docs-17; the bounded binding is now {% local \u2026 %} \u2026 {% endlocal %} in RawBars/MaxBars; ClassicBars has neither \u2014 alias with {{#with x as |n|}})"
      });
    }
    ;
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "case")) {
      return new Just({
        off: v.value0.start,
        shape: '{{#case}} (multi-arm `case` is a RawBars/MaxBars construct; ClassicBars has no `case` \u2014 chain {{#if (eq subject "v")}}\u2026{{else if (eq subject "w")}}\u2026{{else}}\u2026{{/if}})'
      });
    }
    ;
    if (v instanceof Block) {
      return strictSurfaceViolation(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node2)(nodes));
};
var splitOnIn = function(args) {
  var isIn = function(v2) {
    if (v2 instanceof App2 && (v2.value0 === "in" && v2.value1.length === 0)) {
      return true;
    }
    ;
    return false;
  };
  var v = findIndex(isIn)(args);
  if (v instanceof Just) {
    return new Just({
      before: take(v.value0)(args),
      after: drop(v.value0 + 1 | 0)(args)
    });
  }
  ;
  if (v instanceof Nothing) {
    return Nothing.value;
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.Surface (line 337, column 18 - line 339, column 21): " + [v.constructor.name]);
};
var splitFirstEq = function(s) {
  var v = indexOf("=")(s);
  if (v instanceof Just) {
    return {
      key: take2(v.value0)(s),
      rest: drop2(v.value0 + 1 | 0)(s)
    };
  }
  ;
  if (v instanceof Nothing) {
    return {
      key: s,
      rest: ""
    };
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.Surface (line 547, column 18 - line 549, column 34): " + [v.constructor.name]);
};
var segmentsOf = function(s) {
  var flush = function(st) {
    var $145 = st.cur === "";
    if ($145) {
      return st;
    }
    ;
    return {
      inB: st.inB,
      segs: snoc(st.segs)(st.cur),
      cur: ""
    };
  };
  var step2 = function(st) {
    return function(c) {
      if (st.inB) {
        var $148 = c === "]";
        if ($148) {
          return {
            cur: st.cur,
            segs: st.segs,
            inB: false
          };
        }
        ;
        return {
          inB: st.inB,
          segs: st.segs,
          cur: st.cur + singleton5(c)
        };
      }
      ;
      if (c === "[") {
        var v2 = flush(st);
        return {
          cur: v2.cur,
          segs: v2.segs,
          inB: true
        };
      }
      ;
      if (c === "." || c === "/") {
        return flush(st);
      }
      ;
      if (otherwise) {
        return {
          inB: st.inB,
          segs: st.segs,
          cur: st.cur + singleton5(c)
        };
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 840, column 3 - line 844, column 53): " + [st.constructor.name, c.constructor.name]);
    };
  };
  var $$final = foldl3(step2)({
    segs: [],
    cur: "",
    inB: false
  })(toCharArray(s));
  var parts = filter(function(v2) {
    return v2 !== "";
  })(flush($$final).segs);
  var v = uncons(parts);
  if (v instanceof Just && v.value0.head === "this") {
    return v.value0.tail;
  }
  ;
  return parts;
};
var segKey = function(seg) {
  var v = fromString2(seg);
  if (v instanceof Just) {
    return new Lit(new VNumber(toNumber(v.value0)));
  }
  ;
  if (v instanceof Nothing) {
    return new Lit(new VString(seg));
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.Surface (line 849, column 14 - line 851, column 31): " + [v.constructor.name]);
};
var retiredLetViolation = function(nodes) {
  var node2 = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "let")) {
      return new Just({
        off: v.value0.start,
        shape: "{% let \u2026 %} (`let` is retired \u2014 docs-17; the bounded binding is now {% local \u2026 %} \u2026 {% endlocal %}, the forward binding is {% set name = \u2026 %})"
      });
    }
    ;
    if (v instanceof Block) {
      return retiredLetViolation(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node2)(nodes));
};
var reservedMarker = "\0reserved";
var reservedScope = function(lv) {
  return function(name2) {
    if (name2 === reservedMarker) {
      return new Just(reservedMarker);
    }
    ;
    if (otherwise) {
      return lv(name2);
    }
    ;
    throw new Error("Failed pattern match at ClassicBars.Surface (line 122, column 1 - line 122, column 38): " + [lv.constructor.name, name2.constructor.name]);
  };
};
var $lazy_renameSurfaceHeads = /* @__PURE__ */ $runtime_lazy3("renameSurfaceHeads", "ClassicBars.Surface", function() {
  var canonicalHead = function(v) {
    if (v === "scope") {
      return "with";
    }
    ;
    if (v === "for") {
      return "each";
    }
    ;
    return v;
  };
  var node2 = function(v) {
    if (v instanceof Block) {
      return new Block(v.value0, v.value1, canonicalHead(v.value2), v.value3, $lazy_renameSurfaceHeads(773)(v.value4));
    }
    ;
    return v;
  };
  return map5(node2);
});
var renameSurfaceHeads = /* @__PURE__ */ $lazy_renameSurfaceHeads(768);
var parents = function(n) {
  if (n <= 0) {
    return new App2("this", []);
  }
  ;
  if (n === 1) {
    return new App2("parent", []);
  }
  ;
  if (otherwise) {
    return new App2("parent", [parents(n - 1 | 0)]);
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.Surface (line 820, column 1 - line 820, column 23): " + [n.constructor.name]);
};
var noLoopVars = function(v) {
  return Nothing.value;
};
var maxbarsEachAsViolation = function(nodes) {
  var isAs = function(v) {
    if (v instanceof App2 && (v.value0 === "as" && v.value1.length === 0)) {
      return true;
    }
    ;
    return false;
  };
  var node2 = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && (v.value2 === "for" && any2(isAs)(v.value3)))) {
      return new Just({
        off: v.value0.start,
        shape: "{% for \u2026 as \u2026 %} (MaxBars binds loops Liquid-style \u2014 write the names before `in`, e.g. {% for x in xs %} or {% for x i in xs %}; the trailing `as` form is gone. `scope`/custom helpers still use `as`.)"
      });
    }
    ;
    if (v instanceof Block) {
      return maxbarsEachAsViolation(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node2)(nodes));
};
var extractLabel = function(name2) {
  return function(args) {
    if (name2 === "each") {
      var v = unsnoc(args);
      if (v instanceof Just && (v.value0.last instanceof App2 && (v.value0.last.value1.length === 0 && v.value0.last.value0 !== "|"))) {
        var v1 = unsnoc(v.value0.init);
        if (v1 instanceof Just && (v1.value0.last instanceof App2 && (v1.value0.last.value0 === "label" && v1.value0.last.value1.length === 0))) {
          return {
            args: v1.value0.init,
            label: new Just(v.value0.last.value0)
          };
        }
        ;
        return {
          args,
          label: Nothing.value
        };
      }
      ;
      return {
        args,
        label: Nothing.value
      };
    }
    ;
    if (otherwise) {
      return {
        args,
        label: Nothing.value
      };
    }
    ;
    throw new Error("Failed pattern match at ClassicBars.Surface (line 498, column 1 - line 498, column 85): " + [name2.constructor.name, args.constructor.name]);
  };
};
var expandElseIf = /* @__PURE__ */ (function() {
  var toElif = function(v) {
    var v1 = function(v2) {
      return v;
    };
    if (v instanceof Sep && v.value1 === "else") {
      var $206 = uncons(v.value2);
      if ($206 instanceof Just && ($206.value0.head instanceof App2 && ($206.value0.head.value0 === "if" && $206.value0.head.value1.length === 0))) {
        var $207 = !$$null($206.value0.tail);
        if ($207) {
          return new Sep(v.value0, "elif", $206.value0.tail);
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
  return map5(toElif);
})();
var elseIfViolation = function(nodes) {
  var node2 = function(v) {
    var v1 = function(v2) {
      if (v instanceof Block) {
        return elseIfViolation(v.value4);
      }
      ;
      return Nothing.value;
    };
    if (v instanceof Sep && v.value1 === "else") {
      var $223 = uncons(v.value2);
      if ($223 instanceof Just && ($223.value0.head instanceof App2 && ($223.value0.head.value0 === "if" && $223.value0.head.value1.length === 0))) {
        return new Just({
          off: v.value0.start,
          shape: "{% else if \u2026 %} (the chained conditional is spelled {% elif \u2026 %} in RawBars/MaxBars \u2014 `else if` is a ClassicBars/Handlebars-only form)"
        });
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
  return head(mapMaybe(node2)(nodes));
};
var eachLoopViolation = function(nodes) {
  var node2 = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "each")) {
      return new Just({
        off: v.value0.start,
        shape: "{% each \u2026 %} (the loop keyword is renamed `for` \u2014 write {% for x in xs %} (or bare {% for xs %}) \u2026 {% endfor %}; `each` is reserved, ADR-039)"
      });
    }
    ;
    if (v instanceof Block) {
      return eachLoopViolation(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node2)(nodes));
};
var dictExpr = function(pairs) {
  return new App2("dict", concatMap(function(p) {
    return [new Lit(new VString(p.key)), p.val];
  })(pairs));
};
var dataExpr = function(raw) {
  var loopField2 = function(v2) {
    if (v2 === "index") {
      return "index0";
    }
    ;
    return v2;
  };
  var v = stripParents(raw)(0);
  var v1 = uncons(segmentsOf(v.rest));
  if (v1 instanceof Just) {
    if (v.depth === 0) {
      var $245 = $$null(v1.value0.tail);
      if ($245) {
        return new App2(v1.value0.head, []);
      }
      ;
      return new App2("lookup", cons(new App2(v1.value0.head, []))(map5(segKey)(v1.value0.tail)));
    }
    ;
    if (otherwise) {
      return new App2("lookup", cons(new App2("loop", []))(append1(replicate(v.depth)(new Lit(new VString("parent"))))(cons(segKey(loopField2(v1.value0.head)))(map5(segKey)(v1.value0.tail)))));
    }
    ;
  }
  ;
  if (v1 instanceof Nothing) {
    return new App2("this", []);
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.Surface (line 631, column 5 - line 645, column 31): " + [v1.constructor.name]);
};
var pathExpr = function(lv) {
  return function(scope) {
    return function(raw) {
      if (raw === "this" || raw === ".") {
        return new App2("this", []);
      }
      ;
      if (otherwise) {
        var scopedHead = function(name2) {
          return function(tail2) {
            var $254 = $$null(tail2);
            if ($254) {
              return new App2(name2, []);
            }
            ;
            return new App2("lookup", cons(new App2(name2, []))(map5(segKey)(tail2)));
          };
        };
        var reserved2 = isJust(lv(reservedMarker));
        var v = stripPrefix("@")(raw);
        if (v instanceof Just) {
          return dataExpr(v.value0);
        }
        ;
        if (v instanceof Nothing) {
          var v1 = stripParents(raw)(0);
          var segs = segmentsOf(v1.rest);
          var v2 = uncons(segs);
          if (v2 instanceof Just) {
            if (v1.depth === 0 && elem3(v2.value0.head)(scope)) {
              var $259 = $$null(v2.value0.tail);
              if ($259) {
                return new App2(v2.value0.head, []);
              }
              ;
              return new App2("lookup", cons(new App2(v2.value0.head, []))(map5(segKey)(v2.value0.tail)));
            }
            ;
            if (reserved2 && (v1.depth === 0 && v2.value0.head === "loop")) {
              return scopedHead("loop")(v2.value0.tail);
            }
            ;
            if (reserved2 && (v1.depth === 0 && v2.value0.head === "root")) {
              return scopedHead("root")(v2.value0.tail);
            }
            ;
            if (reserved2 && (v1.depth === 0 && v2.value0.head === "parent")) {
              return scopedHead("@parentchain")(v2.value0.tail);
            }
            ;
            if (reserved2 && (v1.depth === 0 && v2.value0.head === "yield")) {
              return scopedHead("yield")(v2.value0.tail);
            }
            ;
          }
          ;
          var v3 = function(v4) {
            var base = parents(v1.depth);
            var $263 = $$null(segs);
            if ($263) {
              return base;
            }
            ;
            return new App2("lookup", cons(base)(map5(segKey)(segs)));
          };
          if (v2 instanceof Just) {
            var $265 = v1.depth === 0 && $$null(v2.value0.tail);
            if ($265) {
              var $266 = lv(raw);
              if ($266 instanceof Just) {
                return new App2($266.value0, []);
              }
              ;
              return v3(true);
            }
            ;
            return v3(true);
          }
          ;
          return v3(true);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars.Surface (line 573, column 7 - line 611, column 72): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 569, column 1 - line 569, column 47): " + [lv.constructor.name, scope.constructor.name, raw.constructor.name]);
    };
  };
};
var hashValue = function(lv) {
  return function(scope) {
    return function(t) {
      if (t === "true" || (t === "false" || t === "null")) {
        return new App2(t, []);
      }
      ;
      if (otherwise) {
        var v = fromString(t);
        if (v instanceof Just) {
          return new Lit(new VNumber(v.value0));
        }
        ;
        if (v instanceof Nothing) {
          return pathExpr(lv)(scope)(t);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars.Surface (line 555, column 17 - line 557, column 37): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 552, column 1 - line 552, column 49): " + [lv.constructor.name, scope.constructor.name, t.constructor.name]);
    };
  };
};
var pathOrLit = function(lv) {
  return function(scope) {
    return function(name2) {
      if (name2 === "true" || (name2 === "false" || name2 === "null")) {
        return new App2(name2, []);
      }
      ;
      if (otherwise) {
        return pathExpr(lv)(scope)(name2);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 561, column 1 - line 561, column 48): " + [lv.constructor.name, scope.constructor.name, name2.constructor.name]);
    };
  };
};
var $lazy_collectInlineSigs = /* @__PURE__ */ $runtime_lazy3("collectInlineSigs", "ClassicBars.Surface", function() {
  var nameOf = function(args) {
    var v = head(args);
    if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
      return new Just(v.value0.value0.value0);
    }
    ;
    return Nothing.value;
  };
  var asParam = function(v) {
    if (v instanceof App2 && v.value1.length === 0) {
      return new Just({
        name: v.value0,
        "default": Nothing.value
      });
    }
    ;
    if (v instanceof App2 && v.value1.length === 1) {
      return new Just({
        name: v.value0,
        "default": new Just(v["value1"][0])
      });
    }
    ;
    return Nothing.value;
  };
  var step2 = function(acc) {
    return function(v) {
      var v1 = function(v2) {
        if (v instanceof Block) {
          return union2(acc)($lazy_collectInlineSigs(427)(v.value4));
        }
        ;
        return acc;
      };
      if (v instanceof Block && v.value2 === "inline") {
        var $298 = nameOf(v.value3);
        if ($298 instanceof Just) {
          var params = mapMaybe(asParam)(drop(1)(v.value3));
          var acc$prime = (function() {
            var $299 = $$null(params);
            if ($299) {
              return acc;
            }
            ;
            return insert2($298.value0)(params)(acc);
          })();
          return union2(acc$prime)($lazy_collectInlineSigs(426)(v.value4));
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
  return foldl2(step2)(empty2);
});
var collectInlineSigs = /* @__PURE__ */ $lazy_collectInlineSigs(416);
var bareIdentNames = /* @__PURE__ */ mapMaybe(function(v) {
  if (v instanceof App2 && v.value1.length === 0) {
    return new Just(v.value0);
  }
  ;
  return Nothing.value;
});
var extractBlockParams = function(dropPipes) {
  return function(args) {
    var paramNames = mapMaybe(function(v2) {
      if (v2 instanceof App2 && v2.value1.length === 0) {
        var v1 = replaceAll("|")("")(v2.value0);
        if (v1 === "") {
          return Nothing.value;
        }
        ;
        return new Just(v1);
      }
      ;
      return Nothing.value;
    });
    var looksLikeParams = function(a) {
      var v2 = head(a);
      if (v2 instanceof Just && (v2.value0 instanceof App2 && v2.value0.value1.length === 0)) {
        return notEq1(stripPrefix("|")(v2.value0.value0))(Nothing.value);
      }
      ;
      return false;
    };
    var isAs = function(v2) {
      if (v2 instanceof App2 && (v2.value0 === "as" && v2.value1.length === 0)) {
        return true;
      }
      ;
      return false;
    };
    var v = findIndex(isAs)(args);
    if (v instanceof Just) {
      if (dropPipes) {
        return {
          mainArgs: take(v.value0)(args),
          params: bareIdentNames(drop(v.value0 + 1 | 0)(args))
        };
      }
      ;
      if (looksLikeParams(drop(v.value0 + 1 | 0)(args))) {
        return {
          mainArgs: take(v.value0)(args),
          params: paramNames(drop(v.value0 + 1 | 0)(args))
        };
      }
      ;
    }
    ;
    return {
      mainArgs: args,
      params: []
    };
  };
};
var asHashKey = function(lv) {
  return function(scope) {
    return function(v) {
      if (v instanceof App2 && (v.value1.length === 0 && contains("=")(v.value0))) {
        var v1 = splitFirstEq(v.value0);
        return new Just((function() {
          var $324 = v1.rest === "";
          if ($324) {
            return {
              key: v1.key,
              consumesNext: true,
              inlineVal: new App2("null", [])
            };
          }
          ;
          return {
            key: v1.key,
            consumesNext: false,
            inlineVal: hashValue(lv)(scope)(v1.rest)
          };
        })());
      }
      ;
      return Nothing.value;
    };
  };
};
var rewriteArgs = function(lv) {
  return function(scope) {
    return function(args) {
      var h = collectHash(lv)(scope)(args);
      var $329 = $$null(h.pairs);
      if ($329) {
        return map5(rewrite(lv)(scope))(h.positional);
      }
      ;
      return snoc(map5(rewrite(lv)(scope))(h.positional))(dictExpr(h.pairs));
    };
  };
};
var rewrite = function(lv) {
  return function(scope) {
    return function(v) {
      if (v instanceof Lit) {
        return new Lit(v.value0);
      }
      ;
      if (v instanceof App2) {
        if ($$null(v.value1)) {
          return pathOrLit(lv)(scope)(v.value0);
        }
        ;
        if (otherwise) {
          return new App2(v.value0, rewriteArgs(lv)(scope)(v.value1));
        }
        ;
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 453, column 20 - line 457, column 56): " + [v.constructor.name]);
    };
  };
};
var collectHash = function(lv) {
  return function(scope) {
    var go = function($copy_acc) {
      return function($copy_args) {
        var $tco_var_acc = $copy_acc;
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(acc, args) {
          var v = uncons(args);
          if (v instanceof Nothing) {
            $tco_done = true;
            return acc;
          }
          ;
          if (v instanceof Just) {
            var v1 = asHashKey(lv)(scope)(v.value0.head);
            if (v1 instanceof Just && v1.value0.consumesNext) {
              var v2 = uncons(v.value0.tail);
              if (v2 instanceof Just) {
                $tco_var_acc = {
                  positional: acc.positional,
                  pairs: snoc(acc.pairs)({
                    key: v1.value0.key,
                    val: rewrite(lv)(scope)(v2.value0.head)
                  })
                };
                $copy_args = v2.value0.tail;
                return;
              }
              ;
              if (v2 instanceof Nothing) {
                $tco_var_acc = {
                  positional: acc.positional,
                  pairs: snoc(acc.pairs)({
                    key: v1.value0.key,
                    val: new App2("null", [])
                  })
                };
                $copy_args = [];
                return;
              }
              ;
              throw new Error("Failed pattern match at ClassicBars.Surface (line 520, column 43 - line 523, column 92): " + [v2.constructor.name]);
            }
            ;
            if (v1 instanceof Just) {
              $tco_var_acc = {
                positional: acc.positional,
                pairs: snoc(acc.pairs)({
                  key: v1.value0.key,
                  val: v1.value0.inlineVal
                })
              };
              $copy_args = v.value0.tail;
              return;
            }
            ;
            if (v1 instanceof Nothing) {
              $tco_var_acc = {
                pairs: acc.pairs,
                positional: snoc(acc.positional)(v.value0.head)
              };
              $copy_args = v.value0.tail;
              return;
            }
            ;
            throw new Error("Failed pattern match at ClassicBars.Surface (line 519, column 28 - line 526, column 79): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at ClassicBars.Surface (line 517, column 17 - line 526, column 79): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($tco_var_acc, $copy_args);
        }
        ;
        return $tco_result;
      };
    };
    return go({
      positional: [],
      pairs: []
    });
  };
};
var blockHeadArgs = function(lv) {
  return function(scope) {
    return function(mainArgs) {
      return function(params) {
        return function(label) {
          var paramMarker = function(p) {
            return new App2("@param", [new Lit(new VString(p))]);
          };
          var labelMarker = maybe([])(function(n) {
            return [new App2("@label", [new Lit(new VString(n))])];
          });
          var hashMarker = function(pairs) {
            return new App2("@hash", concatMap(function(p) {
              return [new Lit(new VString(p.key)), p.val];
            })(pairs));
          };
          var h = collectHash(lv)(scope)(mainArgs);
          var pos = map5(rewrite(lv)(scope))(h.positional);
          var withHash = (function() {
            var $349 = $$null(h.pairs);
            if ($349) {
              return pos;
            }
            ;
            return snoc(pos)(hashMarker(h.pairs));
          })();
          return append1(withHash)(append1(map5(paramMarker)(params))(labelMarker(label)));
        };
      };
    };
  };
};
var partialCall = function(sigs) {
  return function(lv) {
    return function(scope) {
      return function(nameExpr) {
        return function(valueArgs) {
          var sig = (function() {
            if (nameExpr instanceof Lit && nameExpr.value0 instanceof VString) {
              return fromMaybe([])(lookup3(nameExpr.value0.value0)(sigs));
            }
            ;
            return [];
          })();
          var h = collectHash(lv)(scope)(valueArgs);
          var provided = map5(function(v) {
            return v.key;
          })(h.pairs);
          var defaults = mapMaybe(function(p) {
            if (p["default"] instanceof Just && !elem3(p.name)(provided)) {
              return new Just({
                key: p.name,
                val: rewrite(lv)(scope)(p["default"].value0)
              });
            }
            ;
            return Nothing.value;
          })(sig);
          var pairs = append1(h.pairs)(defaults);
          var ctx2 = maybe(new App2("this", []))(rewrite(lv)(scope))(head(h.positional));
          var $355 = $$null(pairs);
          if ($355) {
            return [nameExpr, ctx2];
          }
          ;
          return [nameExpr, ctx2, dictExpr(pairs)];
        };
      };
    };
  };
};
var partialName = function(lv) {
  return function(scope) {
    return function(v) {
      if (v instanceof App2 && v.value1.length === 0) {
        return new Lit(new VString(v.value0));
      }
      ;
      return rewrite(lv)(scope)(v);
    };
  };
};
var inlineArgs = function(lv) {
  return function(scope) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just) {
        return [partialName(lv)(scope)(v.value0.head)];
      }
      ;
      if (v instanceof Nothing) {
        return [new Lit(new VString(""))];
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.Surface (line 439, column 28 - line 441, column 34): " + [v.constructor.name]);
    };
  };
};
var partialArgs = function(sigs) {
  return function(lv) {
    return function(scope) {
      return function(args) {
        var v = uncons(args);
        if (v instanceof Just) {
          return partialCall(sigs)(lv)(scope)(partialName(lv)(scope)(v.value0.head))(v.value0.tail);
        }
        ;
        if (v instanceof Nothing) {
          return [new Lit(new VString("")), new App2("this", [])];
        }
        ;
        throw new Error("Failed pattern match at ClassicBars.Surface (line 405, column 34 - line 407, column 49): " + [v.constructor.name]);
      };
    };
  };
};
var partialExpr = function(sigs) {
  return function(lv) {
    return function(scope) {
      return function(rest) {
        return function(args) {
          var v = (function() {
            if (rest === "") {
              var v1 = uncons(args);
              if (v1 instanceof Just) {
                return {
                  nameExpr: partialName(lv)(scope)(v1.value0.head),
                  valueArgs: v1.value0.tail
                };
              }
              ;
              if (v1 instanceof Nothing) {
                return {
                  nameExpr: new Lit(new VString("")),
                  valueArgs: []
                };
              }
              ;
              throw new Error("Failed pattern match at ClassicBars.Surface (line 369, column 13 - line 371, column 65): " + [v1.constructor.name]);
            }
            ;
            return {
              nameExpr: new Lit(new VString(rest)),
              valueArgs: args
            };
          })();
          if (v.nameExpr instanceof Lit && (v.nameExpr.value0 instanceof VString && v.nameExpr.value0.value0 === "@partial-block")) {
            return new App2("partial-block", []);
          }
          ;
          return new App2("partial", partialCall(sigs)(lv)(scope)(v.nameExpr)(v.valueArgs));
        };
      };
    };
  };
};
var rewriteHead = function(lv) {
  return function(scope) {
    return function(name2) {
      return function(args) {
        if ($$null(args)) {
          return pathOrLit(lv)(scope)(name2);
        }
        ;
        if (otherwise) {
          return new App2(name2, rewriteArgs(lv)(scope)(args));
        }
        ;
        throw new Error("Failed pattern match at ClassicBars.Surface (line 354, column 1 - line 354, column 64): " + [lv.constructor.name, scope.constructor.name, name2.constructor.name, args.constructor.name]);
      };
    };
  };
};
var desugarWith = function(lv) {
  return function(clauseNames) {
    return function(tmpl) {
      var takeBinding = function(scope) {
        return function(args) {
          var v = uncons(args);
          if (v instanceof Just) {
            var v1 = asHashKey(lv)(scope)(v.value0.head);
            if (v1 instanceof Just && v1.value0.consumesNext) {
              var v2 = uncons(v.value0.tail);
              if (v2 instanceof Just) {
                return new Just({
                  key: v1.value0.key,
                  val: rewrite(lv)(scope)(v2.value0.head),
                  rest: v2.value0.tail
                });
              }
              ;
              if (v2 instanceof Nothing) {
                return new Just({
                  key: v1.value0.key,
                  val: new App2("null", []),
                  rest: []
                });
              }
              ;
              throw new Error("Failed pattern match at ClassicBars.Surface (line 165, column 43 - line 167, column 62): " + [v2.constructor.name]);
            }
            ;
            if (v1 instanceof Just) {
              return new Just({
                key: v1.value0.key,
                val: v1.value0.inlineVal,
                rest: v.value0.tail
              });
            }
            ;
            if (v1 instanceof Nothing) {
              return Nothing.value;
            }
            ;
            throw new Error("Failed pattern match at ClassicBars.Surface (line 164, column 28 - line 169, column 25): " + [v1.constructor.name]);
          }
          ;
          if (v instanceof Nothing) {
            return Nothing.value;
          }
          ;
          throw new Error("Failed pattern match at ClassicBars.Surface (line 163, column 28 - line 170, column 23): " + [v.constructor.name]);
        };
      };
      var sigs = collectInlineSigs(tmpl);
      var dropPipes = isJust(lv(reservedMarker));
      var letNode = function(sp) {
        return function(scope) {
          return function(args) {
            return function(body) {
              var v = takeBinding(scope)(args);
              if (v instanceof Nothing) {
                return new Block(sp, Section.value, "local", [], go(scope)(body));
              }
              ;
              if (v instanceof Just) {
                return new Block(sp, Section.value, "local", [new App2("@hash", [new Lit(new VString(v.value0.key)), v.value0.val])], (function() {
                  var $397 = $$null(v.value0.rest);
                  if ($397) {
                    return go(append1(scope)([v.value0.key]))(body);
                  }
                  ;
                  return [letNode(sp)(append1(scope)([v.value0.key]))(v.value0.rest)(body)];
                })());
              }
              ;
              throw new Error("Failed pattern match at ClassicBars.Surface (line 155, column 32 - line 161, column 10): " + [v.constructor.name]);
            };
          };
        };
      };
      var inlineSigDesugar = function(sp) {
        return function(scope) {
          return function(args) {
            return function(body) {
              var paramName = function(v2) {
                if (v2 instanceof App2) {
                  return new Just(v2.value0);
                }
                ;
                return Nothing.value;
              };
              var v = uncons(args);
              if (v instanceof Just && !$$null(v.value0.tail)) {
                var innerScope = append1(scope)(mapMaybe(paramName)(v.value0.tail));
                return new Block(sp, Section.value, "inline", [v.value0.head], go(innerScope)(expandElseIf(body)));
              }
              ;
              return new Block(sp, Section.value, "inline", inlineArgs(lv)(scope)(args), go(scope)(expandElseIf(body)));
            };
          };
        };
      };
      var go = function(scope) {
        var node2 = function(v) {
          if (v instanceof Content) {
            return new Content(v.value0, v.value1);
          }
          ;
          if (v instanceof NodeError) {
            return new NodeError(v.value0, v.value1);
          }
          ;
          if (v instanceof Output) {
            return new Output(v.value0, rewrite(lv)(scope)(v.value1));
          }
          ;
          if (v instanceof Sep) {
            if (elem3(v.value1)(clauseNames)) {
              return new Sep(v.value0, v.value1, rewriteArgs(lv)(scope)(v.value2));
            }
            ;
            if (otherwise) {
              var v1 = stripPrefix(">")(v.value1);
              if (v1 instanceof Just) {
                return new Output(v.value0, partialExpr(sigs)(lv)(scope)(v1.value0)(v.value2));
              }
              ;
              if (v1 instanceof Nothing) {
                return new Output(v.value0, new App2("escapeHtml", [rewriteHead(lv)(scope)(v.value1)(v.value2)]));
              }
              ;
              throw new Error("Failed pattern match at ClassicBars.Surface (line 214, column 24 - line 218, column 87): " + [v1.constructor.name]);
            }
            ;
          }
          ;
          if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "partial")) {
            return new Block(v.value0, Section.value, "partial", partialArgs(sigs)(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
          }
          ;
          if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
            return inlineSigDesugar(v.value0)(scope)(v.value3)(v.value4);
          }
          ;
          if (v instanceof Block && (v.value1 instanceof Decorator && v.value2 === "inline")) {
            return new Block(v.value0, Section.value, "inline", inlineArgs(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
          }
          ;
          if (v instanceof Block && v.value1 instanceof PartialBlock) {
            return new Block(v.value0, Section.value, "partial", partialArgs(sigs)(lv)(scope)(cons(new App2(v.value2, []))(v.value3)), go(scope)(expandElseIf(v.value4)));
          }
          ;
          if (v instanceof Block && v.value1 instanceof Inverse) {
            return new Block(v.value0, Section.value, "unless", [rewriteHead(lv)(scope)(v.value2)(v.value3)], go(scope)(expandElseIf(v.value4)));
          }
          ;
          if (v instanceof Block && (v.value1 instanceof Section && (v.value2 === "local" && dropPipes))) {
            return letNode(v.value0)(scope)(v.value3)(expandElseIf(v.value4));
          }
          ;
          if (v instanceof Block && (v.value1 instanceof Section && (v.value2 === "each" && dropPipes))) {
            var v1 = extractLabel("each")(v.value3);
            var v2 = splitOnIn(v1.args);
            if (v2 instanceof Just) {
              var names = bareIdentNames(v2.value0.before);
              var bodyScope = append1(scope)(append1(names)(maybe([])(pure2)(v1.label)));
              return new Block(v.value0, Section.value, "each", blockHeadArgs(lv)(scope)(take(1)(v2.value0.after))(names)(v1.label), go(bodyScope)(expandElseIf(v.value4)));
            }
            ;
            if (v2 instanceof Nothing) {
              return new Block(v.value0, Section.value, "each", blockHeadArgs(lv)(scope)(v1.args)([])(v1.label), go(append1(scope)(maybe([])(pure2)(v1.label)))(expandElseIf(v.value4)));
            }
            ;
            throw new Error("Failed pattern match at ClassicBars.Surface (line 262, column 11 - line 272, column 72): " + [v2.constructor.name]);
          }
          ;
          if (v instanceof Block && v.value1 instanceof Section) {
            var v1 = extractLabel(v.value2)(v.value3);
            var v2 = extractBlockParams(dropPipes)(v1.args);
            var bodyScope = append1(scope)(append1(v2.params)(maybe([])(pure2)(v1.label)));
            return new Block(v.value0, Section.value, v.value2, blockHeadArgs(lv)(scope)(v2.mainArgs)(v2.params)(v1.label), go(bodyScope)(expandElseIf(v.value4)));
          }
          ;
          if (v instanceof Block) {
            var v1 = extractBlockParams(dropPipes)(v.value3);
            return new Block(v.value0, v.value1, v.value2, blockHeadArgs(lv)(scope)(v1.mainArgs)(v1.params)(Nothing.value), go(append1(scope)(v1.params))(expandElseIf(v.value4)));
          }
          ;
          if (v instanceof RawBlock) {
            return new RawBlock(v.value0, v.value1, v.value2, v.value3);
          }
          ;
          throw new Error("Failed pattern match at ClassicBars.Surface (line 203, column 12 - line 295, column 61): " + [v.constructor.name]);
        };
        return map5(node2);
      };
      return go([])(tmpl);
    };
  };
};
var desugar = /* @__PURE__ */ desugarWith(noLoopVars);

// output/Control.Monad.Error.Class/index.js
var throwError = function(dict) {
  return dict.throwError;
};
var monadThrowEither = /* @__PURE__ */ (function() {
  return {
    throwError: Left.create,
    Monad0: function() {
      return monadEither;
    }
  };
})();

// output/Control.Monad.Trans.Class/index.js
var lift = function(dict) {
  return dict.lift;
};

// output/Control.Monad.Writer.Class/index.js
var tell = function(dict) {
  return dict.tell;
};
var listen = function(dict) {
  return dict.listen;
};

// output/Control.Monad.Writer.Trans/index.js
var WriterT = function(x) {
  return x;
};
var runWriterT = function(v) {
  return v;
};
var monadTransWriterT = function(dictMonoid) {
  var mempty2 = mempty(dictMonoid);
  return {
    lift: function(dictMonad) {
      var bind20 = bind(dictMonad.Bind1());
      var pure19 = pure(dictMonad.Applicative0());
      return function(m) {
        return bind20(m)(function(a) {
          return pure19(new Tuple(a, mempty2));
        });
      };
    }
  };
};
var mapWriterT = function(f) {
  return function(v) {
    return f(v);
  };
};
var functorWriterT = function(dictFunctor) {
  var map37 = map(dictFunctor);
  return {
    map: function(f) {
      return mapWriterT(map37(function(v) {
        return new Tuple(f(v.value0), v.value1);
      }));
    }
  };
};
var applyWriterT = function(dictSemigroup) {
  var append11 = append(dictSemigroup);
  return function(dictApply) {
    var apply4 = apply(dictApply);
    var Functor0 = dictApply.Functor0();
    var map37 = map(Functor0);
    var functorWriterT1 = functorWriterT(Functor0);
    return {
      apply: function(v) {
        return function(v1) {
          var k = function(v3) {
            return function(v4) {
              return new Tuple(v3.value0(v4.value0), append11(v3.value1)(v4.value1));
            };
          };
          return apply4(map37(k)(v))(v1);
        };
      },
      Functor0: function() {
        return functorWriterT1;
      }
    };
  };
};
var bindWriterT = function(dictSemigroup) {
  var append11 = append(dictSemigroup);
  var applyWriterT1 = applyWriterT(dictSemigroup);
  return function(dictBind) {
    var bind20 = bind(dictBind);
    var Apply0 = dictBind.Apply0();
    var map37 = map(Apply0.Functor0());
    var applyWriterT2 = applyWriterT1(Apply0);
    return {
      bind: function(v) {
        return function(k) {
          return bind20(v)(function(v1) {
            var v2 = k(v1.value0);
            return map37(function(v3) {
              return new Tuple(v3.value0, append11(v1.value1)(v3.value1));
            })(v2);
          });
        };
      },
      Apply0: function() {
        return applyWriterT2;
      }
    };
  };
};
var applicativeWriterT = function(dictMonoid) {
  var mempty2 = mempty(dictMonoid);
  var applyWriterT1 = applyWriterT(dictMonoid.Semigroup0());
  return function(dictApplicative) {
    var pure19 = pure(dictApplicative);
    var applyWriterT2 = applyWriterT1(dictApplicative.Apply0());
    return {
      pure: function(a) {
        return pure19(new Tuple(a, mempty2));
      },
      Apply0: function() {
        return applyWriterT2;
      }
    };
  };
};
var monadWriterT = function(dictMonoid) {
  var applicativeWriterT1 = applicativeWriterT(dictMonoid);
  var bindWriterT1 = bindWriterT(dictMonoid.Semigroup0());
  return function(dictMonad) {
    var applicativeWriterT22 = applicativeWriterT1(dictMonad.Applicative0());
    var bindWriterT22 = bindWriterT1(dictMonad.Bind1());
    return {
      Applicative0: function() {
        return applicativeWriterT22;
      },
      Bind1: function() {
        return bindWriterT22;
      }
    };
  };
};
var monadTellWriterT = function(dictMonoid) {
  var Semigroup0 = dictMonoid.Semigroup0();
  var monadWriterT1 = monadWriterT(dictMonoid);
  return function(dictMonad) {
    var monadWriterT2 = monadWriterT1(dictMonad);
    return {
      tell: (function() {
        var $262 = pure(dictMonad.Applicative0());
        var $263 = Tuple.create(unit);
        return function($264) {
          return WriterT($262($263($264)));
        };
      })(),
      Semigroup0: function() {
        return Semigroup0;
      },
      Monad1: function() {
        return monadWriterT2;
      }
    };
  };
};
var monadWriterWriterT = function(dictMonoid) {
  var monadTellWriterT1 = monadTellWriterT(dictMonoid);
  return function(dictMonad) {
    var bind20 = bind(dictMonad.Bind1());
    var pure19 = pure(dictMonad.Applicative0());
    var monadTellWriterT2 = monadTellWriterT1(dictMonad);
    return {
      listen: function(v) {
        return bind20(v)(function(v1) {
          return pure19(new Tuple(new Tuple(v1.value0, v1.value1), v1.value1));
        });
      },
      pass: function(v) {
        return bind20(v)(function(v1) {
          return pure19(new Tuple(v1.value0.value0, v1.value0.value1(v1.value1)));
        });
      },
      Monoid0: function() {
        return dictMonoid;
      },
      MonadTell1: function() {
        return monadTellWriterT2;
      }
    };
  };
};
var monadThrowWriterT = function(dictMonoid) {
  var lift3 = lift(monadTransWriterT(dictMonoid));
  var monadWriterT1 = monadWriterT(dictMonoid);
  return function(dictMonadThrow) {
    var Monad0 = dictMonadThrow.Monad0();
    var lift1 = lift3(Monad0);
    var throwError3 = throwError(dictMonadThrow);
    var monadWriterT2 = monadWriterT1(Monad0);
    return {
      throwError: function(e) {
        return lift1(throwError3(e));
      },
      Monad0: function() {
        return monadWriterT2;
      }
    };
  };
};

// output/Data.Array.NonEmpty.Internal/index.js
var NonEmptyArray = function(x) {
  return x;
};
var showNonEmptyArray = function(dictShow) {
  var show20 = show(showArray(dictShow));
  return {
    show: function(v) {
      return "(NonEmptyArray " + (show20(v) + ")");
    }
  };
};

// output/Data.Array.NonEmpty/index.js
var fromJust5 = /* @__PURE__ */ fromJust();
var unsafeFromArray = NonEmptyArray;
var toArray = function(v) {
  return v;
};
var singleton6 = function($110) {
  return unsafeFromArray(singleton2($110));
};
var fromArray = function(xs) {
  if (length(xs) > 0) {
    return new Just(unsafeFromArray(xs));
  }
  ;
  if (otherwise) {
    return Nothing.value;
  }
  ;
  throw new Error("Failed pattern match at Data.Array.NonEmpty (line 161, column 1 - line 161, column 58): " + [xs.constructor.name]);
};
var adaptMaybe = function(f) {
  return function($126) {
    return fromJust5(f(toArray($126)));
  };
};
var head2 = /* @__PURE__ */ adaptMaybe(head);

// output/FlatBars.Span/index.js
var spanText = function(src) {
  return function(v) {
    return take2(v.end - v.start | 0)(drop2(v.start)(src));
  };
};
var lineColumn = function(src) {
  return function(offset) {
    var cs = toCharArray(take2(offset)(src));
    var nls = length(filter(function(v) {
      return v === "\n";
    })(cs));
    var col = (function() {
      var v = findLastIndex(function(v1) {
        return v1 === "\n";
      })(cs);
      if (v instanceof Just) {
        return length(cs) - v.value0 | 0;
      }
      ;
      if (v instanceof Nothing) {
        return length(cs) + 1 | 0;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Span (line 35, column 11 - line 37, column 37): " + [v.constructor.name]);
    })();
    return {
      line: nls + 1 | 0,
      column: col
    };
  };
};

// output/FlatBars.Error/index.js
var show2 = /* @__PURE__ */ show(showInt);
var map6 = /* @__PURE__ */ map(functorArray);
var UnterminatedTag = /* @__PURE__ */ (function() {
  function UnterminatedTag2(value0) {
    this.value0 = value0;
  }
  ;
  UnterminatedTag2.create = function(value0) {
    return new UnterminatedTag2(value0);
  };
  return UnterminatedTag2;
})();
var UnterminatedComment = /* @__PURE__ */ (function() {
  function UnterminatedComment2(value0) {
    this.value0 = value0;
  }
  ;
  UnterminatedComment2.create = function(value0) {
    return new UnterminatedComment2(value0);
  };
  return UnterminatedComment2;
})();
var UnterminatedRaw = /* @__PURE__ */ (function() {
  function UnterminatedRaw2(value0) {
    this.value0 = value0;
  }
  ;
  UnterminatedRaw2.create = function(value0) {
    return new UnterminatedRaw2(value0);
  };
  return UnterminatedRaw2;
})();
var MismatchedBlock = /* @__PURE__ */ (function() {
  function MismatchedBlock2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  MismatchedBlock2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new MismatchedBlock2(value0, value1, value2);
      };
    };
  };
  return MismatchedBlock2;
})();
var HeadNotIdent = /* @__PURE__ */ (function() {
  function HeadNotIdent2(value0) {
    this.value0 = value0;
  }
  ;
  HeadNotIdent2.create = function(value0) {
    return new HeadNotIdent2(value0);
  };
  return HeadNotIdent2;
})();
var EmptyOutput = /* @__PURE__ */ (function() {
  function EmptyOutput2(value0) {
    this.value0 = value0;
  }
  ;
  EmptyOutput2.create = function(value0) {
    return new EmptyOutput2(value0);
  };
  return EmptyOutput2;
})();
var BadEscape = /* @__PURE__ */ (function() {
  function BadEscape2(value0) {
    this.value0 = value0;
  }
  ;
  BadEscape2.create = function(value0) {
    return new BadEscape2(value0);
  };
  return BadEscape2;
})();
var LexError = /* @__PURE__ */ (function() {
  function LexError2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  LexError2.create = function(value0) {
    return function(value1) {
      return new LexError2(value0, value1);
    };
  };
  return LexError2;
})();
var DirectiveAfterHeader = /* @__PURE__ */ (function() {
  function DirectiveAfterHeader2(value0) {
    this.value0 = value0;
  }
  ;
  DirectiveAfterHeader2.create = function(value0) {
    return new DirectiveAfterHeader2(value0);
  };
  return DirectiveAfterHeader2;
})();
var BadDirective = /* @__PURE__ */ (function() {
  function BadDirective2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  BadDirective2.create = function(value0) {
    return function(value1) {
      return new BadDirective2(value0, value1);
    };
  };
  return BadDirective2;
})();
var DisallowedShape = /* @__PURE__ */ (function() {
  function DisallowedShape2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  DisallowedShape2.create = function(value0) {
    return function(value1) {
      return new DisallowedShape2(value0, value1);
    };
  };
  return DisallowedShape2;
})();
var UnknownHelper = /* @__PURE__ */ (function() {
  function UnknownHelper2(value0) {
    this.value0 = value0;
  }
  ;
  UnknownHelper2.create = function(value0) {
    return new UnknownHelper2(value0);
  };
  return UnknownHelper2;
})();
var ArityError = /* @__PURE__ */ (function() {
  function ArityError2(value0) {
    this.value0 = value0;
  }
  ;
  ArityError2.create = function(value0) {
    return new ArityError2(value0);
  };
  return ArityError2;
})();
var $$TypeError = /* @__PURE__ */ (function() {
  function $$TypeError2(value0) {
    this.value0 = value0;
  }
  ;
  $$TypeError2.create = function(value0) {
    return new $$TypeError2(value0);
  };
  return $$TypeError2;
})();
var ClauseError = /* @__PURE__ */ (function() {
  function ClauseError2(value0) {
    this.value0 = value0;
  }
  ;
  ClauseError2.create = function(value0) {
    return new ClauseError2(value0);
  };
  return ClauseError2;
})();
var HelperError = /* @__PURE__ */ (function() {
  function HelperError2(value0) {
    this.value0 = value0;
  }
  ;
  HelperError2.create = function(value0) {
    return new HelperError2(value0);
  };
  return HelperError2;
})();
var RecursionLimit = /* @__PURE__ */ (function() {
  function RecursionLimit2(value0) {
    this.value0 = value0;
  }
  ;
  RecursionLimit2.create = function(value0) {
    return new RecursionLimit2(value0);
  };
  return RecursionLimit2;
})();
var DirectiveError = /* @__PURE__ */ (function() {
  function DirectiveError2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  DirectiveError2.create = function(value0) {
    return function(value1) {
      return new DirectiveError2(value0, value1);
    };
  };
  return DirectiveError2;
})();
var ParseFailure = /* @__PURE__ */ (function() {
  function ParseFailure2(value0) {
    this.value0 = value0;
  }
  ;
  ParseFailure2.create = function(value0) {
    return new ParseFailure2(value0);
  };
  return ParseFailure2;
})();
var parseErrorOffset = function(v) {
  if (v instanceof UnterminatedTag) {
    return v.value0;
  }
  ;
  if (v instanceof UnterminatedComment) {
    return v.value0;
  }
  ;
  if (v instanceof UnterminatedRaw) {
    return v.value0;
  }
  ;
  if (v instanceof MismatchedBlock) {
    return v.value2;
  }
  ;
  if (v instanceof HeadNotIdent) {
    return v.value0;
  }
  ;
  if (v instanceof EmptyOutput) {
    return v.value0;
  }
  ;
  if (v instanceof BadEscape) {
    return v.value0;
  }
  ;
  if (v instanceof LexError) {
    return v.value1;
  }
  ;
  if (v instanceof DirectiveAfterHeader) {
    return v.value0;
  }
  ;
  if (v instanceof BadDirective) {
    return v.value1;
  }
  ;
  if (v instanceof DisallowedShape) {
    return v.value1;
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Error (line 75, column 20 - line 86, column 27): " + [v.constructor.name]);
};
var parseErrorMessage = function(v) {
  if (v instanceof UnterminatedTag) {
    return "UnterminatedTag: opener with no closer";
  }
  ;
  if (v instanceof UnterminatedComment) {
    return "UnterminatedComment: {{! with no }}";
  }
  ;
  if (v instanceof UnterminatedRaw) {
    return "UnterminatedRaw: {{{{#name}}}} with no matching close";
  }
  ;
  if (v instanceof MismatchedBlock) {
    return "MismatchedBlock: {{/" + (v.value1 + ("}} closing {{#" + (v.value0 + "}}")));
  }
  ;
  if (v instanceof HeadNotIdent) {
    return "HeadNotIdent: an application head must be an identifier";
  }
  ;
  if (v instanceof EmptyOutput) {
    return "EmptyOutput: {{{}}} with no expression";
  }
  ;
  if (v instanceof BadEscape) {
    return "BadEscape: invalid string escape";
  }
  ;
  if (v instanceof LexError) {
    return "LexError: " + v.value0;
  }
  ;
  if (v instanceof DirectiveAfterHeader) {
    return "DirectiveAfterHeader: a {{! @directive }} must precede the first tag";
  }
  ;
  if (v instanceof BadDirective) {
    return "BadDirective: " + v.value0;
  }
  ;
  if (v instanceof DisallowedShape) {
    return "DisallowedShape: " + (v.value0 + " is not allowed in this dialect");
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Error (line 55, column 21 - line 68, column 95): " + [v.constructor.name]);
};
var renderParseError = function(pe) {
  return parseErrorMessage(pe) + (" (at " + (show2(parseErrorOffset(pe)) + ")"));
};
var renderError = function(v) {
  if (v instanceof UnknownHelper) {
    return "UnknownHelper: no helper named '" + (v.value0 + "' in any frame");
  }
  ;
  if (v instanceof ArityError) {
    return "ArityError: " + v.value0;
  }
  ;
  if (v instanceof $$TypeError) {
    return "TypeError: " + v.value0;
  }
  ;
  if (v instanceof ClauseError) {
    return "ClauseError: " + v.value0;
  }
  ;
  if (v instanceof HelperError) {
    return "HelperError: " + v.value0;
  }
  ;
  if (v instanceof RecursionLimit) {
    return "RecursionLimit: partial recursion exceeded budget of " + show2(v.value0);
  }
  ;
  if (v instanceof DirectiveError) {
    return "DirectiveError: " + (v.value0 + (" (at " + (show2(v.value1) + ")")));
  }
  ;
  if (v instanceof ParseFailure) {
    return "ParseFailure: " + joinWith("; ")(map6(renderParseError)(toArray(v.value0)));
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Error (line 146, column 15 - line 155, column 97): " + [v.constructor.name]);
};
var showError = {
  show: renderError
};
var showParseError = {
  show: renderParseError
};
var parseErrorAt = function(src) {
  return function(pe) {
    var offset = parseErrorOffset(pe);
    var v = lineColumn(src)(offset);
    return {
      line: v.line,
      column: v.column,
      offset,
      message: parseErrorMessage(pe)
    };
  };
};
var renderParseErrorAt = function(src) {
  return function(pe) {
    var d = parseErrorAt(src)(pe);
    return show2(d.line) + (":" + (show2(d.column) + (": " + d.message)));
  };
};
var renderParseErrorsAt = function(src) {
  var $168 = joinWith("\n");
  var $169 = map6(renderParseErrorAt(src));
  return function($170) {
    return $168($169(toArray($170)));
  };
};

// output/Data.List/index.js
var map7 = /* @__PURE__ */ map(functorMaybe);
var uncons3 = function(v) {
  if (v instanceof Nil) {
    return Nothing.value;
  }
  ;
  if (v instanceof Cons) {
    return new Just({
      head: v.value0,
      tail: v.value1
    });
  }
  ;
  throw new Error("Failed pattern match at Data.List (line 259, column 1 - line 259, column 66): " + [v.constructor.name]);
};
var toUnfoldable3 = function(dictUnfoldable) {
  return unfoldr(dictUnfoldable)(function(xs) {
    return map7(function(rec) {
      return new Tuple(rec.head, rec.tail);
    })(uncons3(xs));
  });
};
var reverse2 = /* @__PURE__ */ (function() {
  var go = function($copy_v) {
    return function($copy_v1) {
      var $tco_var_v = $copy_v;
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(v, v1) {
        if (v1 instanceof Nil) {
          $tco_done = true;
          return v;
        }
        ;
        if (v1 instanceof Cons) {
          $tco_var_v = new Cons(v1.value0, v);
          $copy_v1 = v1.value1;
          return;
        }
        ;
        throw new Error("Failed pattern match at Data.List (line 368, column 3 - line 368, column 19): " + [v.constructor.name, v1.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($tco_var_v, $copy_v1);
      }
      ;
      return $tco_result;
    };
  };
  return go(Nil.value);
})();
var last2 = function($copy_v) {
  var $tco_done = false;
  var $tco_result;
  function $tco_loop(v) {
    if (v instanceof Cons && v.value1 instanceof Nil) {
      $tco_done = true;
      return new Just(v.value0);
    }
    ;
    if (v instanceof Cons) {
      $copy_v = v.value1;
      return;
    }
    ;
    $tco_done = true;
    return Nothing.value;
  }
  ;
  while (!$tco_done) {
    $tco_result = $tco_loop($copy_v);
  }
  ;
  return $tco_result;
};
var index2 = function($copy_v) {
  return function($copy_v1) {
    var $tco_var_v = $copy_v;
    var $tco_done = false;
    var $tco_result;
    function $tco_loop(v, v1) {
      if (v instanceof Nil) {
        $tco_done = true;
        return Nothing.value;
      }
      ;
      if (v instanceof Cons && v1 === 0) {
        $tco_done = true;
        return new Just(v.value0);
      }
      ;
      if (v instanceof Cons) {
        $tco_var_v = v.value1;
        $copy_v1 = v1 - 1 | 0;
        return;
      }
      ;
      throw new Error("Failed pattern match at Data.List (line 281, column 1 - line 281, column 44): " + [v.constructor.name, v1.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_v, $copy_v1);
    }
    ;
    return $tco_result;
  };
};
var head3 = function(v) {
  if (v instanceof Nil) {
    return Nothing.value;
  }
  ;
  if (v instanceof Cons) {
    return new Just(v.value0);
  }
  ;
  throw new Error("Failed pattern match at Data.List (line 230, column 1 - line 230, column 22): " + [v.constructor.name]);
};

// output/FlatBars.Token/index.js
var eqMaybe2 = /* @__PURE__ */ eqMaybe(eqChar);
var eq12 = /* @__PURE__ */ eq(eqMaybe2);
var notEq3 = /* @__PURE__ */ notEq(eqMaybe2);
var TIdent = /* @__PURE__ */ (function() {
  function TIdent2(value0) {
    this.value0 = value0;
  }
  ;
  TIdent2.create = function(value0) {
    return new TIdent2(value0);
  };
  return TIdent2;
})();
var TStr = /* @__PURE__ */ (function() {
  function TStr2(value0) {
    this.value0 = value0;
  }
  ;
  TStr2.create = function(value0) {
    return new TStr2(value0);
  };
  return TStr2;
})();
var TNum = /* @__PURE__ */ (function() {
  function TNum2(value0) {
    this.value0 = value0;
  }
  ;
  TNum2.create = function(value0) {
    return new TNum2(value0);
  };
  return TNum2;
})();
var TLParen = /* @__PURE__ */ (function() {
  function TLParen2() {
  }
  ;
  TLParen2.value = new TLParen2();
  return TLParen2;
})();
var TRParen = /* @__PURE__ */ (function() {
  function TRParen2() {
  }
  ;
  TRParen2.value = new TRParen2();
  return TRParen2;
})();
var TLBracket = /* @__PURE__ */ (function() {
  function TLBracket2() {
  }
  ;
  TLBracket2.value = new TLBracket2();
  return TLBracket2;
})();
var TRBracket = /* @__PURE__ */ (function() {
  function TRBracket2() {
  }
  ;
  TRBracket2.value = new TRBracket2();
  return TRBracket2;
})();
var TLBrace = /* @__PURE__ */ (function() {
  function TLBrace2() {
  }
  ;
  TLBrace2.value = new TLBrace2();
  return TLBrace2;
})();
var TRBrace = /* @__PURE__ */ (function() {
  function TRBrace2() {
  }
  ;
  TRBrace2.value = new TRBrace2();
  return TRBrace2;
})();
var TComma = /* @__PURE__ */ (function() {
  function TComma2() {
  }
  ;
  TComma2.value = new TComma2();
  return TComma2;
})();
var TOp = /* @__PURE__ */ (function() {
  function TOp2(value0) {
    this.value0 = value0;
  }
  ;
  TOp2.create = function(value0) {
    return new TOp2(value0);
  };
  return TOp2;
})();
var $$unescape = function(v) {
  if (v === "\\") {
    return new Just("\\");
  }
  ;
  if (v === '"') {
    return new Just('"');
  }
  ;
  if (v === "'") {
    return new Just("'");
  }
  ;
  if (v === "n") {
    return new Just("\n");
  }
  ;
  if (v === "t") {
    return new Just("	");
  }
  ;
  if (v === "r") {
    return new Just("\r");
  }
  ;
  return Nothing.value;
};
var isWs = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var isDigit = function(c) {
  return c >= "0" && c <= "9";
};
var isNumChar = function(c) {
  return isDigit(c) || c === ".";
};
var isAlpha = function(c) {
  return c >= "a" && c <= "z" || c >= "A" && c <= "Z";
};
var isIdentChar = function(c) {
  return isAlpha(c) || (isDigit(c) || (c === "_" || (c === "-" || (c === "." || (c === "@" || (c === "/" || (c === "+" || (c === "*" || (c === "?" || c === "=")))))))));
};
var tokenizeInterior = function(base) {
  return function(src) {
    var push4 = function(acc) {
      return function(t) {
        return function(i) {
          return function(j) {
            return snoc(acc)({
              tok: t,
              at: base + i | 0,
              end: base + j | 0
            });
          };
        };
      };
    };
    var cs = toCharArray(src);
    var len = length(cs);
    var slc = function(a) {
      return function(b) {
        return fromCharArray(slice(a)(b)(cs));
      };
    };
    var bad = function(i) {
      return new Left(new LexError("unexpected character", base + i | 0));
    };
    var at = function(i) {
      return index(cs)(i);
    };
    var readString = function(start) {
      return function(q) {
        return function(acc) {
          var collect2 = function($copy_j) {
            return function($copy_chars) {
              var $tco_var_j = $copy_j;
              var $tco_done = false;
              var $tco_result;
              function $tco_loop(j, chars) {
                var v = at(j);
                if (v instanceof Nothing) {
                  $tco_done = true;
                  return new Left(new LexError("unterminated string", base + start | 0));
                }
                ;
                if (v instanceof Just) {
                  if (v.value0 === q) {
                    $tco_done = true;
                    return go(j + 1 | 0)(push4(acc)(new TStr(fromCharArray(reverse(chars))))(start)(j + 1 | 0));
                  }
                  ;
                  if (v.value0 === "\\") {
                    var v1 = at(j + 1 | 0);
                    if (v1 instanceof Just) {
                      var v2 = $$unescape(v1.value0);
                      if (v2 instanceof Just) {
                        $tco_var_j = j + 2 | 0;
                        $copy_chars = cons(v2.value0)(chars);
                        return;
                      }
                      ;
                      if (v2 instanceof Nothing) {
                        $tco_done = true;
                        return new Left(new LexError("invalid string escape", base + j | 0));
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Token (line 189, column 23 - line 191, column 76): " + [v2.constructor.name]);
                    }
                    ;
                    if (v1 instanceof Nothing) {
                      $tco_done = true;
                      return new Left(new LexError("unterminated string", base + start | 0));
                    }
                    ;
                    throw new Error("Failed pattern match at FlatBars.Token (line 188, column 24 - line 192, column 76): " + [v1.constructor.name]);
                  }
                  ;
                  if (otherwise) {
                    $tco_var_j = j + 1 | 0;
                    $copy_chars = cons(v.value0)(chars);
                    return;
                  }
                  ;
                }
                ;
                throw new Error("Failed pattern match at FlatBars.Token (line 183, column 23 - line 193, column 60): " + [v.constructor.name]);
              }
              ;
              while (!$tco_done) {
                $tco_result = $tco_loop($tco_var_j, $copy_chars);
              }
              ;
              return $tco_result;
            };
          };
          return collect2(start + 1 | 0)([]);
        };
      };
    };
    var readNumber = function(start) {
      return function(acc) {
        var numEnd = function($copy_j) {
          var $tco_done1 = false;
          var $tco_result;
          function $tco_loop(j) {
            var v2 = at(j);
            if (v2 instanceof Just && isNumChar(v2.value0)) {
              $copy_j = j + 1 | 0;
              return;
            }
            ;
            $tco_done1 = true;
            return j;
          }
          ;
          while (!$tco_done1) {
            $tco_result = $tco_loop($copy_j);
          }
          ;
          return $tco_result;
        };
        var end = numEnd(start + 1 | 0);
        var raw = slc(start)(end);
        var v = fromString(raw);
        if (v instanceof Just) {
          return go(end)(push4(acc)(new TNum(v.value0))(start)(end));
        }
        ;
        if (v instanceof Nothing) {
          return new Left(new LexError("malformed number '" + (raw + "'"), base + start | 0));
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Token (line 172, column 7 - line 174, column 87): " + [v.constructor.name]);
      };
    };
    var readIdent = function(start) {
      return function(acc) {
        var skipWs = function($copy_k) {
          var $tco_done2 = false;
          var $tco_result;
          function $tco_loop(k) {
            var v = at(k);
            if (v instanceof Just && isWs(v.value0)) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            $tco_done2 = true;
            return k;
          }
          ;
          while (!$tco_done2) {
            $tco_result = $tco_loop($copy_k);
          }
          ;
          return $tco_result;
        };
        var hashEqAt = function(j) {
          var w = skipWs(j);
          return j > start && (eq12(at(w))(new Just("=")) && notEq3(at(w + 1 | 0))(new Just("=")));
        };
        var bracketEnd = function($copy_k) {
          var $tco_done3 = false;
          var $tco_result;
          function $tco_loop(k) {
            if (k > len) {
              $tco_done3 = true;
              return Nothing.value;
            }
            ;
            if (eq12(at(k))(new Just("]"))) {
              $tco_done3 = true;
              return new Just(k);
            }
            ;
            if (otherwise) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Token (line 161, column 5 - line 164, column 39): " + [k.constructor.name]);
          }
          ;
          while (!$tco_done3) {
            $tco_result = $tco_loop($copy_k);
          }
          ;
          return $tco_result;
        };
        var scan = function($copy_j) {
          var $tco_done4 = false;
          var $tco_result;
          function $tco_loop(j) {
            var v = at(j);
            if (v instanceof Just && v.value0 === "[") {
              var v1 = bracketEnd(j + 1 | 0);
              if (v1 instanceof Just) {
                $copy_j = v1.value0 + 1 | 0;
                return;
              }
              ;
              if (v1 instanceof Nothing) {
                $tco_done4 = true;
                return new Left(new LexError("unterminated [ segment", base + j | 0));
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Token (line 138, column 19 - line 140, column 71): " + [v1.constructor.name]);
            }
            ;
            if (v instanceof Just && isIdentChar(v.value0)) {
              $copy_j = j + 1 | 0;
              return;
            }
            ;
            if (hashEqAt(j)) {
              $tco_done4 = true;
              return go(skipWs(j) + 1 | 0)(push4(acc)(new TIdent(slc(start)(j) + "="))(start)(skipWs(j) + 1 | 0));
            }
            ;
            $tco_done4 = true;
            return go(j)(push4(acc)(new TIdent(slc(start)(j)))(start)(j));
          }
          ;
          while (!$tco_done4) {
            $tco_result = $tco_loop($copy_j);
          }
          ;
          return $tco_result;
        };
        return scan(start);
      };
    };
    var op2 = function(s) {
      return function(i) {
        return function(acc) {
          return go(i + 2 | 0)(push4(acc)(new TOp(s))(i)(i + 2 | 0));
        };
      };
    };
    var op1 = function(s) {
      return function(i) {
        return function(acc) {
          return go(i + 1 | 0)(push4(acc)(new TOp(s))(i)(i + 1 | 0));
        };
      };
    };
    var go = function($copy_i) {
      return function($copy_acc) {
        var $tco_var_i = $copy_i;
        var $tco_done5 = false;
        var $tco_result;
        function $tco_loop(i, acc) {
          if (i >= len) {
            $tco_done5 = true;
            return new Right(acc);
          }
          ;
          if (otherwise) {
            var v = at(i);
            if (v instanceof Nothing) {
              $tco_done5 = true;
              return new Right(acc);
            }
            ;
            if (v instanceof Just) {
              if (isWs(v.value0)) {
                $tco_var_i = i + 1 | 0;
                $copy_acc = acc;
                return;
              }
              ;
              if (v.value0 === "(") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TLParen.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === ")") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TRParen.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === '"' || v.value0 === "'") {
                $tco_done5 = true;
                return readString(i)(v.value0)(acc);
              }
              ;
              if (v.value0 === "&") {
                var $64 = eq12(at(i + 1 | 0))(new Just("&"));
                if ($64) {
                  $tco_done5 = true;
                  return op2("&&")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return bad(i);
              }
              ;
              if (v.value0 === "|") {
                var $65 = eq12(at(i + 1 | 0))(new Just("|"));
                if ($65) {
                  $tco_done5 = true;
                  return op2("||")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("|")(i)(acc);
              }
              ;
              if (v.value0 === "!") {
                var $66 = eq12(at(i + 1 | 0))(new Just("="));
                if ($66) {
                  $tco_done5 = true;
                  return op2("!=")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("!")(i)(acc);
              }
              ;
              if (v.value0 === "<") {
                var $67 = eq12(at(i + 1 | 0))(new Just("="));
                if ($67) {
                  $tco_done5 = true;
                  return op2("<=")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("<")(i)(acc);
              }
              ;
              if (v.value0 === ">") {
                var $68 = eq12(at(i + 1 | 0))(new Just("="));
                if ($68) {
                  $tco_done5 = true;
                  return op2(">=")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1(">")(i)(acc);
              }
              ;
              if (v.value0 === "=") {
                var $69 = eq12(at(i + 1 | 0))(new Just("="));
                if ($69) {
                  $tco_done5 = true;
                  return op2("==")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return bad(i);
              }
              ;
              if (v.value0 === "-" && maybe(false)(isDigit)(at(i + 1 | 0))) {
                $tco_done5 = true;
                return readNumber(i)(acc);
              }
              ;
              if (isDigit(v.value0)) {
                $tco_done5 = true;
                return readNumber(i)(acc);
              }
              ;
              if (isIdentChar(v.value0) || v.value0 === "[") {
                $tco_done5 = true;
                return readIdent(i)(acc);
              }
              ;
              if (otherwise) {
                $tco_done5 = true;
                return bad(i);
              }
              ;
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Token (line 105, column 19 - line 125, column 31): " + [v.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Token (line 102, column 3 - line 102, column 68): " + [i.constructor.name, acc.constructor.name]);
        }
        ;
        while (!$tco_done5) {
          $tco_result = $tco_loop($tco_var_i, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
    return go(0)([]);
  };
};
var eqToken = {
  eq: function(x) {
    return function(y) {
      if (x instanceof TIdent && y instanceof TIdent) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof TStr && y instanceof TStr) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof TNum && y instanceof TNum) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof TLParen && y instanceof TLParen) {
        return true;
      }
      ;
      if (x instanceof TRParen && y instanceof TRParen) {
        return true;
      }
      ;
      if (x instanceof TLBracket && y instanceof TLBracket) {
        return true;
      }
      ;
      if (x instanceof TRBracket && y instanceof TRBracket) {
        return true;
      }
      ;
      if (x instanceof TLBrace && y instanceof TLBrace) {
        return true;
      }
      ;
      if (x instanceof TRBrace && y instanceof TRBrace) {
        return true;
      }
      ;
      if (x instanceof TComma && y instanceof TComma) {
        return true;
      }
      ;
      if (x instanceof TOp && y instanceof TOp) {
        return x.value0 === y.value0;
      }
      ;
      return false;
    };
  }
};

// output/FlatBars.Expr/index.js
var map8 = /* @__PURE__ */ map(functorMaybe);
var bind2 = /* @__PURE__ */ bind(bindEither);
var parseExpr = function(toks) {
  var tk = function(i) {
    return map8(function(v2) {
      return v2.tok;
    })(index(toks)(i));
  };
  var posAt = function(i) {
    var v2 = index(toks)(i);
    if (v2 instanceof Just) {
      return v2.value0.at;
    }
    ;
    if (v2 instanceof Nothing) {
      var v1 = last(toks);
      if (v1 instanceof Just) {
        return v1.value0.at;
      }
      ;
      if (v1 instanceof Nothing) {
        return 0;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Expr (line 37, column 16 - line 39, column 19): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Expr (line 35, column 13 - line 39, column 19): " + [v2.constructor.name]);
  };
  var pExpr = function(i) {
    var v2 = tk(i);
    if (v2 instanceof Just && v2.value0 instanceof TLParen) {
      return bind2(pExpr(i + 1 | 0))(function(v1) {
        var v22 = tk(v1.pos);
        if (v22 instanceof Just && v22.value0 instanceof TRParen) {
          return new Right({
            val: v1.val,
            pos: v1.pos + 1 | 0
          });
        }
        ;
        return new Left(new LexError("expected )", posAt(v1.pos)));
      });
    }
    ;
    if (v2 instanceof Just && v2.value0 instanceof TStr) {
      return new Right({
        val: new Lit(new VString(v2.value0.value0)),
        pos: i + 1 | 0
      });
    }
    ;
    if (v2 instanceof Just && v2.value0 instanceof TNum) {
      return new Right({
        val: new Lit(new VNumber(v2.value0.value0)),
        pos: i + 1 | 0
      });
    }
    ;
    if (v2 instanceof Just && v2.value0 instanceof TIdent) {
      return bind2(pArgs(i + 1 | 0)([]))(function(v1) {
        return new Right({
          val: new App2(v2.value0.value0, v1.val),
          pos: v1.pos
        });
      });
    }
    ;
    return new Left(new LexError("expected an expression", posAt(i)));
  };
  var pArgs = function(i) {
    return function(acc) {
      var v2 = tk(i);
      if (v2 instanceof Just && v2.value0 instanceof TLParen) {
        return bind2(pExpr(i))(function(v1) {
          return pArgs(v1.pos)(snoc(acc)(v1.val));
        });
      }
      ;
      if (v2 instanceof Just && v2.value0 instanceof TStr) {
        return pArgs(i + 1 | 0)(snoc(acc)(new Lit(new VString(v2.value0.value0))));
      }
      ;
      if (v2 instanceof Just && v2.value0 instanceof TNum) {
        return pArgs(i + 1 | 0)(snoc(acc)(new Lit(new VNumber(v2.value0.value0))));
      }
      ;
      if (v2 instanceof Just && v2.value0 instanceof TIdent) {
        return pArgs(i + 1 | 0)(snoc(acc)(new App2(v2.value0.value0, [])));
      }
      ;
      if (v2 instanceof Just && (v2.value0 instanceof TOp && v2.value0.value0 === "|")) {
        return pArgs(i + 1 | 0)(snoc(acc)(new App2("|", [])));
      }
      ;
      return new Right({
        val: acc,
        pos: i
      });
    };
  };
  var len = length(toks);
  var v = pExpr(0);
  if (v instanceof Left) {
    return new Left(v.value0);
  }
  ;
  if (v instanceof Right) {
    if (v.value0.pos >= len) {
      return new Right(v.value0.val);
    }
    ;
    if (otherwise) {
      return new Left(new LexError("unexpected token", posAt(v.value0.pos)));
    }
    ;
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Expr (line 27, column 18 - line 31, column 66): " + [v.constructor.name]);
};

// output/FlatBars.Lexer/index.js
var eq13 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var notEq4 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var elem4 = /* @__PURE__ */ elem2(eqChar);
var fromFoldable3 = /* @__PURE__ */ fromFoldable(foldableList);
var bind3 = /* @__PURE__ */ bind(bindMaybe);
var map9 = /* @__PURE__ */ map(functorEither);
var elem1 = /* @__PURE__ */ elem2(eqString);
var RContent = /* @__PURE__ */ (function() {
  function RContent4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RContent4.create = function(value0) {
    return function(value1) {
      return new RContent4(value0, value1);
    };
  };
  return RContent4;
})();
var ROutput = /* @__PURE__ */ (function() {
  function ROutput3(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  ROutput3.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new ROutput3(value0, value1, value2, value3);
        };
      };
    };
  };
  return ROutput3;
})();
var RAmp = /* @__PURE__ */ (function() {
  function RAmp4(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RAmp4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RAmp4(value0, value1, value2, value3);
        };
      };
    };
  };
  return RAmp4;
})();
var ROpen = /* @__PURE__ */ (function() {
  function ROpen4(value0, value1, value2, value3, value4) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
  }
  ;
  ROpen4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return new ROpen4(value0, value1, value2, value3, value4);
          };
        };
      };
    };
  };
  return ROpen4;
})();
var RClose = /* @__PURE__ */ (function() {
  function RClose4(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RClose4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RClose4(value0, value1, value2, value3);
        };
      };
    };
  };
  return RClose4;
})();
var RSep = /* @__PURE__ */ (function() {
  function RSep5(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RSep5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RSep5(value0, value1, value2, value3);
        };
      };
    };
  };
  return RSep5;
})();
var RRaw = /* @__PURE__ */ (function() {
  function RRaw5(value0, value1, value2, value3, value4, value5) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
    this.value5 = value5;
  }
  ;
  RRaw5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return function(value5) {
              return new RRaw5(value0, value1, value2, value3, value4, value5);
            };
          };
        };
      };
    };
  };
  return RRaw5;
})();
var RComment = /* @__PURE__ */ (function() {
  function RComment4(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RComment4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RComment4(value0, value1, value2);
      };
    };
  };
  return RComment4;
})();
var RSetDelim = /* @__PURE__ */ (function() {
  function RSetDelim3(value0) {
    this.value0 = value0;
  }
  ;
  RSetDelim3.create = function(value0) {
    return new RSetDelim3(value0);
  };
  return RSetDelim3;
})();
var RLongComment = /* @__PURE__ */ (function() {
  function RLongComment3(value0) {
    this.value0 = value0;
  }
  ;
  RLongComment3.create = function(value0) {
    return new RLongComment3(value0);
  };
  return RLongComment3;
})();
var RError = /* @__PURE__ */ (function() {
  function RError4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RError4.create = function(value0) {
    return function(value1) {
      return new RError4(value0, value1);
    };
  };
  return RError4;
})();
var slice3 = function(cs) {
  return function(i) {
    return function(j) {
      return fromCharArray(slice(i)(j)(cs));
    };
  };
};
var nlIndex = function(first) {
  return function(s) {
    var f = (function() {
      if (first) {
        return findIndex;
      }
      ;
      return findLastIndex;
    })();
    return f(function(v) {
      return v === "\n";
    })(toCharArray(s));
  };
};
var matchAt = function(cs) {
  return function(i) {
    return function(pat) {
      var pcs = toCharArray(pat);
      return eq13(slice(i)(i + length(pcs) | 0)(cs))(pcs);
    };
  };
};
var isSpace = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var sepHead = function(s) {
  var cs = dropWhile(isSpace)(toCharArray(s));
  return fromCharArray(takeWhile(function($418) {
    return !isSpace($418);
  })(cs));
};
var trimEndWs = function(s) {
  return fromCharArray(reverse(dropWhile(isSpace)(reverse(toCharArray(s)))));
};
var trimStartWs = function(s) {
  return fromCharArray(dropWhile(isSpace)(toCharArray(s)));
};
var hasNL = function(s) {
  return notEq4(nlIndex(true)(s))(Nothing.value);
};
var findFrom = function(cs) {
  return function(from2) {
    return function(pat) {
      var len = length(cs);
      var go = function($copy_i) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i) {
          if (i > len) {
            $tco_done = true;
            return Nothing.value;
          }
          ;
          if (matchAt(cs)(i)(pat)) {
            $tco_done = true;
            return new Just(i);
          }
          ;
          if (otherwise) {
            $copy_i = i + 1 | 0;
            return;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 115, column 3 - line 118, column 29): " + [i.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_i);
        }
        ;
        return $tco_result;
      };
      return go(from2);
    };
  };
};
var tokenizeTemplate = function(cfg) {
  return function(src) {
    var validDelim = function(d) {
      return !elem4("=")(toCharArray(d));
    };
    var splitTrims = function(raw) {
      var trimL = take2(1)(raw) === "~";
      var r1 = (function() {
        if (trimL) {
          return drop2(1)(raw);
        }
        ;
        return raw;
      })();
      var trimR = takeRight(1)(r1) === "~";
      var core = (function() {
        if (trimR) {
          return dropRight(1)(r1);
        }
        ;
        return r1;
      })();
      return {
        trimL,
        trimR,
        core
      };
    };
    var rawName = function(s) {
      return fromCharArray(takeWhile(function($419) {
        return !isSpace($419);
      })(dropWhile(isSpace)(toCharArray(s))));
    };
    var interiorAt = function(base) {
      return function(s) {
        return tokenizeInterior(base)(s);
      };
    };
    var flush = function(span2) {
      return function(s0) {
        return function(acc) {
          return function(pend) {
            return function(trimR) {
              var s1 = (function() {
                if (pend) {
                  return trimStartWs(s0);
                }
                ;
                return s0;
              })();
              var s2 = (function() {
                if (trimR) {
                  return trimEndWs(s1);
                }
                ;
                return s1;
              })();
              var $206 = s2 === "";
              if ($206) {
                return acc;
              }
              ;
              return new Cons(new RContent(span2, s2), acc);
            };
          };
        };
      };
    };
    var finalize = function($420) {
      return fromFoldable3(reverse2($420));
    };
    var delimWords = function(s) {
      var a0 = dropWhile(isSpace)(toCharArray(s));
      var a1 = dropWhile(isSpace)(dropWhile(function($421) {
        return !isSpace($421);
      })(a0));
      var rest = dropWhile(isSpace)(dropWhile(function($422) {
        return !isSpace($422);
      })(a1));
      var w2 = takeWhile(function($423) {
        return !isSpace($423);
      })(a1);
      var w1 = takeWhile(function($424) {
        return !isSpace($424);
      })(a0);
      var $207 = $$null(w1) || ($$null(w2) || !$$null(rest));
      if ($207) {
        return Nothing.value;
      }
      ;
      return new Just({
        open: fromCharArray(w1),
        close: fromCharArray(w2)
      });
    };
    var parseDelimDirective = function(interior) {
      var t = trimStartWs(interior);
      var v = bind3(stripPrefix("@delimiters")(t))((function() {
        var $425 = stripPrefix(":");
        return function($426) {
          return $425(trimStartWs($426));
        };
      })());
      if (v instanceof Nothing) {
        return Nothing.value;
      }
      ;
      if (v instanceof Just) {
        return new Just((function() {
          var v1 = delimWords(v.value0);
          if (v1 instanceof Just && (validDelim(v1.value0.open) && validDelim(v1.value0.close))) {
            return new Right(v1.value0);
          }
          ;
          return new Left(new LexError("@delimiters expects two whitespace-separated delimiters (no '=')", 0));
        })());
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 471, column 7 - line 478, column 100): " + [v.constructor.name]);
    };
    var delimSwitch = function(v) {
      if (v instanceof Just && (v.value0 instanceof RComment && cfg.mustacheDelims)) {
        var v1 = parseDelimDirective(v.value0.value2);
        if (v1 instanceof Nothing) {
          return new Right(Nothing.value);
        }
        ;
        if (v1 instanceof Just && v1.value0 instanceof Left) {
          return new Left(v1.value0.value0);
        }
        ;
        if (v1 instanceof Just && v1.value0 instanceof Right) {
          return new Right(new Just(v1.value0.value0));
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 458, column 58 - line 461, column 39): " + [v1.constructor.name]);
      }
      ;
      return new Right(Nothing.value);
    };
    var cs = toCharArray(src);
    var leadTrimAt = function(i) {
      return matchAt(cs)(i + 2 | 0)("~");
    };
    var len = length(cs);
    var openerLiteralAt = function(i) {
      if (matchAt(cs)(i)("{{{{#")) {
        return new Just("{{{{#");
      }
      ;
      if (matchAt(cs)(i)("{{{{")) {
        return new Just("{{{{");
      }
      ;
      if (matchAt(cs)(i)("{{~!--")) {
        return new Just("{{~!--");
      }
      ;
      if (matchAt(cs)(i)("{{!--")) {
        return new Just("{{!--");
      }
      ;
      if (matchAt(cs)(i)("{{{^")) {
        return new Just("{{{^");
      }
      ;
      if (matchAt(cs)(i)("{{{/")) {
        return new Just("{{{/");
      }
      ;
      if (matchAt(cs)(i)("{{{")) {
        return new Just("{{{");
      }
      ;
      if (matchAt(cs)(i)("{{~!")) {
        return new Just("{{~!");
      }
      ;
      if (matchAt(cs)(i)("{{!")) {
        return new Just("{{!");
      }
      ;
      if (matchAt(cs)(i)("{{~#")) {
        return new Just("{{~#");
      }
      ;
      if (matchAt(cs)(i)("{{#")) {
        return new Just("{{#");
      }
      ;
      if (matchAt(cs)(i)("{{~^")) {
        return new Just("{{~^");
      }
      ;
      if (matchAt(cs)(i)("{{^")) {
        return new Just("{{^");
      }
      ;
      if (matchAt(cs)(i)("{{~<")) {
        return new Just("{{~<");
      }
      ;
      if (matchAt(cs)(i)("{{<")) {
        return new Just("{{<");
      }
      ;
      if (matchAt(cs)(i)("{{~$")) {
        return new Just("{{~$");
      }
      ;
      if (matchAt(cs)(i)("{{$")) {
        return new Just("{{$");
      }
      ;
      if (matchAt(cs)(i)("{{~/")) {
        return new Just("{{~/");
      }
      ;
      if (matchAt(cs)(i)("{{/")) {
        return new Just("{{/");
      }
      ;
      if (matchAt(cs)(i)("{{~&")) {
        return new Just("{{~&");
      }
      ;
      if (matchAt(cs)(i)("{{&")) {
        return new Just("{{&");
      }
      ;
      if (otherwise) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 505, column 3 - line 505, column 41): " + [i.constructor.name]);
    };
    var isSeparatorAt = function(i) {
      return matchAt(cs)(i)("{{") && (!matchAt(cs)(i)("{{{") && (function() {
        var v = openerLiteralAt(i);
        if (v instanceof Just) {
          return false;
        }
        ;
        if (v instanceof Nothing) {
          return true;
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 534, column 70 - line 536, column 20): " + [v.constructor.name]);
      })());
    };
    var escapedOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        var $227 = isSeparatorAt(i);
        if ($227) {
          return new Just("{{");
        }
        ;
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 545, column 23 - line 547, column 62): " + [v.constructor.name]);
    };
    var isOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return true;
      }
      ;
      if (v instanceof Nothing) {
        return isSeparatorAt(i);
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 539, column 18 - line 541, column 31): " + [v.constructor.name]);
    };
    var pushSeg = function(segStart) {
      return function(frags) {
        return function(end) {
          return function(lit) {
            return snoc(snoc(frags)(slice3(cs)(segStart)(end)))(lit);
          };
        };
      };
    };
    var readCustomTag = function(i) {
      return function(open) {
        return function(close) {
          var start = i + length2(open) | 0;
          var cl = length2(close);
          var v = findFrom(cs)(start)(close);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedTag(i));
          }
          ;
          if (v instanceof Just) {
            var span2 = {
              start: i,
              end: v.value0 + cl | 0
            };
            var next = v.value0 + cl | 0;
            var mk = function(tok) {
              return new Right({
                mtok: new Just(tok),
                next,
                trimL: false,
                trimR: false
              });
            };
            var interior = slice3(cs)(start)(v.value0);
            var afterSig = slice3(cs)(start + 1 | 0)(v.value0);
            var sigOpen = function(sig) {
              return mk(new ROpen(span2, sig, start + 1 | 0, afterSig, interiorAt(start + 1 | 0)(afterSig)));
            };
            var afterHash = slice3(cs)(start + 2 | 0)(v.value0);
            var hashOpen = function(sig) {
              return mk(new ROpen(span2, sig, start + 2 | 0, afterHash, interiorAt(start + 2 | 0)(afterHash)));
            };
            var v1 = index(cs)(start);
            if (v1 instanceof Just && v1.value0 === "#") {
              var v2 = index(cs)(start + 1 | 0);
              if (v2 instanceof Just && v2.value0 === "*") {
                return hashOpen(Decorator.value);
              }
              ;
              if (v2 instanceof Just && v2.value0 === ">") {
                return hashOpen(PartialBlock.value);
              }
              ;
              return sigOpen(Section.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "^") {
              return sigOpen(Inverse.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "<") {
              return sigOpen(Parent.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "$") {
              return sigOpen(BlockDef.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "/") {
              return mk(new RClose(span2, start + 1 | 0, afterSig, interiorAt(start + 1 | 0)(afterSig)));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "&") {
              return mk(new RAmp(span2, start + 1 | 0, afterSig, interiorAt(start + 1 | 0)(afterSig)));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "!") {
              return mk(new RComment(span2, start + 1 | 0, afterSig));
            }
            ;
            return mk(new RSep(span2, start, interior, interiorAt(start)(interior)));
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 844, column 7 - line 875, column 77): " + [v.constructor.name]);
        };
      };
    };
    var readLongComment = function(i) {
      return function(opener) {
        var v = findFrom(cs)(i + length2(opener) | 0)("--}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedComment(i));
        }
        ;
        if (v instanceof Just) {
          return new Right({
            mtok: (function() {
              if (cfg.keepLongComments) {
                return new Just(new RLongComment({
                  start: i,
                  end: v.value0 + 4 | 0
                }));
              }
              ;
              return Nothing.value;
            })(),
            next: v.value0 + 4 | 0,
            trimL: leadTrimAt(i),
            trimR: matchAt(cs)(v.value0 - 1 | 0)("~")
          });
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 737, column 30 - line 744, column 8): " + [v.constructor.name]);
      };
    };
    var readRaw = function(i) {
      return function(sigil) {
        var start = i + sigil | 0;
        var v = findFrom(cs)(start)("}}}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedRaw(i));
        }
        ;
        if (v instanceof Just) {
          var head4 = slice3(cs)(start)(v.value0);
          var closePat = "{{{{/" + (rawName(head4) + "}}}}");
          var bodyStart2 = v.value0 + 4 | 0;
          var v1 = findFrom(cs)(bodyStart2)(closePat);
          if (v1 instanceof Nothing) {
            return new Left(new UnterminatedRaw(i));
          }
          ;
          if (v1 instanceof Just) {
            var end = v1.value0 + length2(closePat) | 0;
            return new Right({
              mtok: new Just(new RRaw({
                start: i,
                end
              }, sigil === 5, start, head4, interiorAt(start)(head4), slice3(cs)(bodyStart2)(v1.value0))),
              next: end,
              trimL: false,
              trimR: false
            });
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 764, column 13 - line 778, column 22): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 753, column 7 - line 778, column 22): " + [v.constructor.name]);
      };
    };
    var readSetDelim = function(i) {
      return function(open) {
        return function(close) {
          var start = (i + length2(open) | 0) + 1 | 0;
          var closePat = "=" + close;
          var v = findFrom(cs)(start)(closePat);
          if (v instanceof Nothing) {
            return new Left(new LexError("unterminated set-delimiter tag (expected '=" + (close + "')"), i));
          }
          ;
          if (v instanceof Just) {
            var v1 = delimWords(slice3(cs)(start)(v.value0));
            if (v1 instanceof Nothing) {
              return new Left(new LexError("set-delimiter expects two whitespace-separated delimiters", i));
            }
            ;
            if (v1 instanceof Just) {
              if (validDelim(v1.value0.open) && validDelim(v1.value0.close)) {
                return new Right({
                  tok: new RSetDelim({
                    start: i,
                    end: v.value0 + length2(closePat) | 0
                  }),
                  next: v.value0 + length2(closePat) | 0,
                  open: v1.value0.open,
                  close: v1.value0.close,
                  trimL: false,
                  trimR: false
                });
              }
              ;
              if (otherwise) {
                return new Left(new LexError("set-delimiter values may not contain '='", i));
              }
              ;
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Lexer (line 800, column 19 - line 811, column 88): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 797, column 7 - line 811, column 88): " + [v.constructor.name]);
        };
      };
    };
    var readShortComment = function(i) {
      return function(opener) {
        var start = i + length2(opener) | 0;
        var v = findFrom(cs)(start)("}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedComment(i));
        }
        ;
        if (v instanceof Just) {
          var trimR = matchAt(cs)(v.value0 - 1 | 0)("~");
          var interior = slice3(cs)(start)((function() {
            if (trimR) {
              return v.value0 - 1 | 0;
            }
            ;
            return v.value0;
          })());
          return new Right({
            mtok: new Just(new RComment({
              start: i,
              end: v.value0 + 2 | 0
            }, start, interior)),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i),
            trimR
          });
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 718, column 7 - line 730, column 16): " + [v.constructor.name]);
      };
    };
    var contentTo = function(segStart) {
      return function(frags) {
        return function(end) {
          return joinWith("")(snoc(frags)(slice3(cs)(segStart)(end)));
        };
      };
    };
    var consTok = function(mtok) {
      return function(acc1) {
        return maybe(acc1)(function(t) {
          return new Cons(t, acc1);
        })(mtok);
      };
    };
    var closeFrom = function(from2) {
      return function(close) {
        return findFrom(cs)(from2)(close);
      };
    };
    var readAmp = function(i) {
      return function(opener) {
        var start = i + length2(opener) | 0;
        var v = closeFrom(start)("}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedTag(i));
        }
        ;
        if (v instanceof Just) {
          var t = splitTrims(slice3(cs)(start)(v.value0));
          return new Right({
            mtok: new Just(new RAmp({
              start: i,
              end: v.value0 + 2 | 0
            }, start, t.core, interiorAt(start)(t.core))),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i) || t.trimL,
            trimR: t.trimR
          });
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 673, column 7 - line 684, column 16): " + [v.constructor.name]);
      };
    };
    var readBlockOpen = function(i) {
      return function(opener) {
        return function(sigil) {
          return function(close) {
            var start = i + length2(opener) | 0;
            var cl = length2(close);
            var v = closeFrom(start)(close);
            if (v instanceof Nothing) {
              return new Left(new UnterminatedTag(i));
            }
            ;
            if (v instanceof Just) {
              var t = splitTrims(slice3(cs)(start)(v.value0));
              return new Right({
                mtok: new Just(new ROpen({
                  start: i,
                  end: v.value0 + cl | 0
                }, sigil, start, t.core, interiorAt(start)(t.core))),
                next: v.value0 + cl | 0,
                trimL: leadTrimAt(i) || t.trimL,
                trimR: t.trimR
              });
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Lexer (line 632, column 7 - line 644, column 16): " + [v.constructor.name]);
          };
        };
      };
    };
    var readClose = function(i) {
      return function(opener) {
        return function(close) {
          var start = i + length2(opener) | 0;
          var cl = length2(close);
          var v = closeFrom(start)(close);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedTag(i));
          }
          ;
          if (v instanceof Just) {
            var t = splitTrims(slice3(cs)(start)(v.value0));
            return new Right({
              mtok: new Just(new RClose({
                start: i,
                end: v.value0 + cl | 0
              }, start, t.core, interiorAt(start)(t.core))),
              next: v.value0 + cl | 0,
              trimL: leadTrimAt(i) || t.trimL,
              trimR: t.trimR
            });
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 654, column 7 - line 665, column 16): " + [v.constructor.name]);
        };
      };
    };
    var readOutput = function(i) {
      var start = i + 3 | 0;
      var v = closeFrom(start)("}}}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice3(cs)(start)(v.value0));
        return new Right({
          mtok: new Just(new ROutput({
            start: i,
            end: v.value0 + 3 | 0
          }, start, t.core, interiorAt(start)(t.core))),
          next: v.value0 + 3 | 0,
          trimL: t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 610, column 7 - line 621, column 16): " + [v.constructor.name]);
    };
    var readSeparator = function(i) {
      var start = (function() {
        var $265 = leadTrimAt(i);
        if ($265) {
          return i + 3 | 0;
        }
        ;
        return i + 2 | 0;
      })();
      var v = closeFrom(start)("}}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice3(cs)(start)(v.value0));
        return new Right({
          mtok: new Just(new RSep({
            start: i,
            end: v.value0 + 2 | 0
          }, start, t.core, interiorAt(start)(t.core))),
          next: v.value0 + 2 | 0,
          trimL: leadTrimAt(i) || t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 694, column 7 - line 705, column 16): " + [v.constructor.name]);
    };
    var readTag = function(i) {
      if (matchAt(cs)(i)("{{{{#")) {
        return readRaw(i)(5);
      }
      ;
      if (matchAt(cs)(i)("{{{{")) {
        return readRaw(i)(4);
      }
      ;
      if (matchAt(cs)(i)("{{~!--")) {
        return readLongComment(i)("{{~!--");
      }
      ;
      if (matchAt(cs)(i)("{{!--")) {
        return readLongComment(i)("{{!--");
      }
      ;
      if (matchAt(cs)(i)("{{{^")) {
        return readBlockOpen(i)("{{{^")(Inverse.value)("}}}");
      }
      ;
      if (matchAt(cs)(i)("{{{/")) {
        return readClose(i)("{{{/")("}}}");
      }
      ;
      if (matchAt(cs)(i)("{{{")) {
        return readOutput(i);
      }
      ;
      if (matchAt(cs)(i)("{{~!")) {
        return readShortComment(i)("{{~!");
      }
      ;
      if (matchAt(cs)(i)("{{!")) {
        return readShortComment(i)("{{!");
      }
      ;
      if (matchAt(cs)(i)("{{~#*")) {
        return readBlockOpen(i)("{{~#*")(Decorator.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{#*")) {
        return readBlockOpen(i)("{{#*")(Decorator.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~#>")) {
        return readBlockOpen(i)("{{~#>")(PartialBlock.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{#>")) {
        return readBlockOpen(i)("{{#>")(PartialBlock.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~#")) {
        return readBlockOpen(i)("{{~#")(Section.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{#")) {
        return readBlockOpen(i)("{{#")(Section.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~^")) {
        return readBlockOpen(i)("{{~^")(Inverse.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{^")) {
        return readBlockOpen(i)("{{^")(Inverse.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~<")) {
        return readBlockOpen(i)("{{~<")(Parent.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{<")) {
        return readBlockOpen(i)("{{<")(Parent.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~$")) {
        return readBlockOpen(i)("{{~$")(BlockDef.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{$")) {
        return readBlockOpen(i)("{{$")(BlockDef.value)("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~/")) {
        return readClose(i)("{{~/")("}}");
      }
      ;
      if (matchAt(cs)(i)("{{/")) {
        return readClose(i)("{{/")("}}");
      }
      ;
      if (matchAt(cs)(i)("{{~&")) {
        return readAmp(i)("{{~&");
      }
      ;
      if (matchAt(cs)(i)("{{&")) {
        return readAmp(i)("{{&");
      }
      ;
      if (matchAt(cs)(i)("{{")) {
        return readSeparator(i);
      }
      ;
      if (otherwise) {
        return new Left(new LexError("internal: no opener", i));
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 549, column 3 - line 549, column 48): " + [i.constructor.name]);
    };
    var recoverFrom = function(i) {
      return function(e) {
        return function(segStart) {
          return function(frags) {
            return function(acc) {
              return function(pend) {
                return function(open) {
                  return function(close) {
                    var resync = fromMaybe(len)(findFrom(cs)(i + length2(open) | 0)(open));
                    var acc2 = new Cons(new RError({
                      start: i,
                      end: resync
                    }, e), flush({
                      start: segStart,
                      end: i
                    })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                    return go(resync)(open)(close)(resync)([])(acc2)(false);
                  };
                };
              };
            };
          };
        };
      };
    };
    var go = function($copy_i) {
      return function($copy_open) {
        return function($copy_close) {
          return function($copy_segStart) {
            return function($copy_frags) {
              return function($copy_acc) {
                return function($copy_pend) {
                  var $tco_var_i = $copy_i;
                  var $tco_var_open = $copy_open;
                  var $tco_var_close = $copy_close;
                  var $tco_var_segStart = $copy_segStart;
                  var $tco_var_frags = $copy_frags;
                  var $tco_var_acc = $copy_acc;
                  var $tco_done = false;
                  var $tco_result;
                  function $tco_loop(i, open, close, segStart, frags, acc, pend) {
                    if (i >= len) {
                      $tco_done = true;
                      return new Right(flush({
                        start: segStart,
                        end: i
                      })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                    }
                    ;
                    if (otherwise) {
                      var v = index(cs)(i);
                      if (v instanceof Nothing) {
                        $tco_done = true;
                        return new Right(flush({
                          start: segStart,
                          end: i
                        })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                      }
                      ;
                      if (v instanceof Just) {
                        if (cfg.mustacheDelims && matchAt(cs)(i)(open + "=")) {
                          var v1 = readSetDelim(i)(open)(close);
                          if (v1 instanceof Left) {
                            $tco_done = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc11 = flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL);
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = v1.value0.open;
                            $tco_var_close = v1.value0.close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = new Cons(v1.value0.tok, acc11);
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 365, column 65 - line 372, column 82): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && (close === "}}" && v.value0 === "\\")) {
                          var $280 = matchAt(cs)(i + 1 | 0)("\\");
                          if ($280) {
                            $tco_var_i = i + 2 | 0;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = i + 2 | 0;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)("\\");
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          var v1 = escapedOpenerAt(i + 1 | 0);
                          if (v1 instanceof Just) {
                            var next = (i + 1 | 0) + length2(v1.value0) | 0;
                            $tco_var_i = next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = next;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)(v1.value0);
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          if (v1 instanceof Nothing) {
                            $tco_var_i = i + 1 | 0;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = i + 1 | 0;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)("\\");
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 380, column 20 - line 386, column 98): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && (close === "}}" && (v.value0 === "{" && isOpenerAt(i)))) {
                          var v1 = readTag(i);
                          if (v1 instanceof Left) {
                            $tco_done = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            var v2 = delimSwitch(v1.value0.mtok);
                            if (v2 instanceof Left) {
                              $tco_done = true;
                              return new Left(v2.value0);
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Nothing) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = open;
                              $tco_var_close = close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Just) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = v2.value0.value0.open;
                              $tco_var_close = v2.value0.value0.close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 396, column 19 - line 399, column 92): " + [v2.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 387, column 74 - line 399, column 92): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && close === "}}") {
                          $tco_var_i = i + 1 | 0;
                          $tco_var_open = open;
                          $tco_var_close = close;
                          $tco_var_segStart = segStart;
                          $tco_var_frags = frags;
                          $tco_var_acc = acc;
                          $copy_pend = pend;
                          return;
                        }
                        ;
                        if (matchAt(cs)(i)(open)) {
                          var v1 = readCustomTag(i)(open)(close);
                          if (v1 instanceof Left) {
                            $tco_done = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            var v2 = delimSwitch(v1.value0.mtok);
                            if (v2 instanceof Left) {
                              $tco_done = true;
                              return new Left(v2.value0);
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Nothing) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = open;
                              $tco_var_close = close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Just) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = v2.value0.value0.open;
                              $tco_var_close = v2.value0.value0.close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 412, column 19 - line 415, column 92): " + [v2.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 403, column 34 - line 415, column 92): " + [v1.constructor.name]);
                        }
                        ;
                        if (otherwise) {
                          $tco_var_i = i + 1 | 0;
                          $tco_var_open = open;
                          $tco_var_close = close;
                          $tco_var_segStart = segStart;
                          $tco_var_frags = frags;
                          $tco_var_acc = acc;
                          $copy_pend = pend;
                          return;
                        }
                        ;
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Lexer (line 358, column 19 - line 416, column 71): " + [v.constructor.name]);
                    }
                    ;
                    throw new Error("Failed pattern match at FlatBars.Lexer (line 346, column 3 - line 354, column 39): " + [i.constructor.name, open.constructor.name, close.constructor.name, segStart.constructor.name, frags.constructor.name, acc.constructor.name, pend.constructor.name]);
                  }
                  ;
                  while (!$tco_done) {
                    $tco_result = $tco_loop($tco_var_i, $tco_var_open, $tco_var_close, $tco_var_segStart, $tco_var_frags, $tco_var_acc, $copy_pend);
                  }
                  ;
                  return $tco_result;
                };
              };
            };
          };
        };
      };
    };
    return map9(finalize)(go(0)(cfg.open)(cfg.close)(0)([])(Nil.value)(false));
  };
};
var dropTrailingIndent = function(s) {
  var v = nlIndex(false)(s);
  if (v instanceof Just) {
    return take2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Lexer (line 257, column 24 - line 259, column 16): " + [v.constructor.name]);
};
var dropLeadingLine = function(s) {
  var v = nlIndex(true)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Lexer (line 250, column 21 - line 252, column 16): " + [v.constructor.name]);
};
var defaultLexConfig = {
  open: "{{",
  close: "}}",
  mustacheDelims: false,
  keepLongComments: false
};
var blockLevel = function(v) {
  if (v instanceof ROpen) {
    return true;
  }
  ;
  if (v instanceof RClose) {
    return true;
  }
  ;
  if (v instanceof RComment) {
    return true;
  }
  ;
  if (v instanceof RSetDelim) {
    return true;
  }
  ;
  return false;
};
var beforeFirstNL = function(s) {
  var v = nlIndex(true)(s);
  if (v instanceof Just) {
    return take2(v.value0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Lexer (line 243, column 19 - line 245, column 15): " + [v.constructor.name]);
};
var allWs = /* @__PURE__ */ (function() {
  var $427 = all2(isSpace);
  return function($428) {
    return $427(toCharArray($428));
  };
})();
var afterLastNL = function(s) {
  var v = nlIndex(false)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Lexer (line 238, column 17 - line 240, column 15): " + [v.constructor.name]);
};
var trimStandalone = function(seps) {
  return function(toks) {
    var rightBlank = function(i) {
      var goRight = function($copy_k) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(k) {
          var v = index(toks)(k);
          if (v instanceof Nothing) {
            $tco_done = true;
            return true;
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent) {
            if (hasNL(v.value0.value1)) {
              $tco_done = true;
              return allWs(beforeFirstNL(v.value0.value1));
            }
            ;
            if (allWs(v.value0.value1)) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            if (otherwise) {
              $tco_done = true;
              return false;
            }
            ;
          }
          ;
          if (v instanceof Just) {
            $tco_done = true;
            return false;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 197, column 17 - line 203, column 22): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_k);
        }
        ;
        return $tco_result;
      };
      return goRight(i + 1 | 0);
    };
    var leftBlank = function(i) {
      var goLeft = function($copy_k) {
        var $tco_done1 = false;
        var $tco_result;
        function $tco_loop(k) {
          var v = index(toks)(k);
          if (v instanceof Nothing) {
            $tco_done1 = true;
            return true;
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent) {
            if (hasNL(v.value0.value1)) {
              $tco_done1 = true;
              return allWs(afterLastNL(v.value0.value1));
            }
            ;
            if (allWs(v.value0.value1)) {
              $copy_k = k - 1 | 0;
              return;
            }
            ;
            if (otherwise) {
              $tco_done1 = true;
              return false;
            }
            ;
          }
          ;
          if (v instanceof Just) {
            $tco_done1 = true;
            return false;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 185, column 16 - line 191, column 22): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done1) {
          $tco_result = $tco_loop($copy_k);
        }
        ;
        return $tco_result;
      };
      return goLeft(i - 1 | 0);
    };
    var eligible2 = function(t) {
      return blockLevel(t) || (function() {
        if (t instanceof RSep) {
          return elem1(sepHead(t.value2))(seps);
        }
        ;
        return false;
      })();
    };
    var standaloneAt = function(i) {
      var v = index(toks)(i);
      if (v instanceof Just && eligible2(v.value0)) {
        return leftBlank(i) && rightBlank(i);
      }
      ;
      return false;
    };
    var trimContent = function(j) {
      return function(v) {
        if (v instanceof RContent) {
          var s1 = (function() {
            var $414 = standaloneAt(j - 1 | 0);
            if ($414) {
              return dropLeadingLine(v.value1);
            }
            ;
            return v.value1;
          })();
          var s2 = (function() {
            var $415 = standaloneAt(j + 1 | 0);
            if ($415) {
              return dropTrailingIndent(s1);
            }
            ;
            return s1;
          })();
          return new RContent(v.value0, s2);
        }
        ;
        return v;
      };
    };
    return mapWithIndex2(trimContent)(toks);
  };
};

// output/FlatBars.Parser/index.js
var eq3 = /* @__PURE__ */ eq(eqToken);
var eq22 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var fromFoldable4 = /* @__PURE__ */ fromFoldable(foldableList);
var eq32 = /* @__PURE__ */ eq(eqSigil);
var append3 = /* @__PURE__ */ append(semigroupArray);
var identity8 = /* @__PURE__ */ identity(categoryFn);
var StopEOF = /* @__PURE__ */ (function() {
  function StopEOF4() {
  }
  ;
  StopEOF4.value = new StopEOF4();
  return StopEOF4;
})();
var StopClose = /* @__PURE__ */ (function() {
  function StopClose4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  StopClose4.create = function(value0) {
    return function(value1) {
      return new StopClose4(value0, value1);
    };
  };
  return StopClose4;
})();
var salvageName = function(toks) {
  var v = head(toks);
  if (v instanceof Just && v.value0.tok instanceof TIdent) {
    return new Just(v.value0.tok.value0);
  }
  ;
  return Nothing.value;
};
var partialHead = function(toks) {
  var v = uncons(toks);
  if (v instanceof Just && eq3(v.value0.head.tok)(new TOp(">"))) {
    return cons({
      at: v.value0.head.at,
      end: v.value0.head.end,
      tok: new TIdent(">")
    })(v.value0.tail);
  }
  ;
  return toks;
};
var outputExpr = function(span2) {
  return function(v) {
    if (v instanceof Left) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Right) {
      if ($$null(v.value0)) {
        return new Left(new EmptyOutput(span2.start));
      }
      ;
      if (otherwise) {
        return parseExpr(v.value0);
      }
      ;
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 312, column 19 - line 316, column 39): " + [v.constructor.name]);
  };
};
var isSpace2 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var isLetter = function(c) {
  return c >= "a" && c <= "z" || c >= "A" && c <= "Z";
};
var isKeyChar = function(c) {
  return isLetter(c) || (c >= "0" && c <= "9" || (c === "_" || c === "-"));
};
var parseDirectives = function(base) {
  return function(interior) {
    var cs = toCharArray(interior);
    var len = length(cs);
    var slc = function(a) {
      return function(b) {
        return fromCharArray(slice(a)(b)(cs));
      };
    };
    var at = function(k) {
      return index(cs)(k);
    };
    var isHead = function(k) {
      return eq22(at(k))(new Just("@")) && maybe(false)(isLetter)(at(k + 1 | 0));
    };
    var valueEnd = function($copy_k) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(k) {
        if (k >= len) {
          $tco_done = true;
          return len;
        }
        ;
        if (isHead(k)) {
          $tco_done = true;
          return k;
        }
        ;
        if (otherwise) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Parser (line 260, column 3 - line 263, column 35): " + [k.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var readKey = function($copy_k) {
      var $tco_done1 = false;
      var $tco_result;
      function $tco_loop(k) {
        var $54 = maybe(false)(isKeyChar)(at(k));
        if ($54) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        $tco_done1 = true;
        return k;
      }
      ;
      while (!$tco_done1) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var skipWs = function($copy_k) {
      var $tco_done2 = false;
      var $tco_result;
      function $tco_loop(k) {
        var $55 = maybe(false)(isSpace2)(at(k));
        if ($55) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        $tco_done2 = true;
        return k;
      }
      ;
      while (!$tco_done2) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var go = function($copy_j) {
      return function($copy_acc) {
        var $tco_var_j = $copy_j;
        var $tco_done3 = false;
        var $tco_result;
        function $tco_loop(j, acc) {
          if (j >= len) {
            $tco_done3 = true;
            return acc;
          }
          ;
          if (isHead(j)) {
            var keyEnd = readKey(j + 1 | 0);
            var key = slc(j + 1 | 0)(keyEnd);
            var afterKey = skipWs(keyEnd);
            var v = at(afterKey);
            if (v instanceof Just && v.value0 === ":") {
              var vStart = skipWs(afterKey + 1 | 0);
              var vEnd = valueEnd(vStart);
              var dir = {
                key,
                value: trim(slc(vStart)(vEnd)),
                span: {
                  start: base + j | 0,
                  end: base + vEnd | 0
                }
              };
              $tco_var_j = vEnd;
              $copy_acc = snoc(acc)(dir);
              return;
            }
            ;
            var dir = {
              key,
              value: "true",
              span: {
                start: base + j | 0,
                end: base + keyEnd | 0
              }
            };
            $tco_var_j = keyEnd;
            $copy_acc = snoc(acc)(dir);
            return;
          }
          ;
          if (otherwise) {
            $tco_var_j = j + 1 | 0;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Parser (line 265, column 3 - line 265, column 50): " + [j.constructor.name, acc.constructor.name]);
        }
        ;
        while (!$tco_done3) {
          $tco_result = $tco_loop($tco_var_j, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
    return go(0)([]);
  };
};
var isComment = function(v) {
  if (v instanceof RComment) {
    return true;
  }
  ;
  return false;
};
var headedRecovering = function(span2) {
  return function(v) {
    if (v instanceof Left) {
      return {
        name: Nothing.value,
        args: [],
        error: new Just(v.value0)
      };
    }
    ;
    if (v instanceof Right) {
      if ($$null(v.value0)) {
        return {
          name: Nothing.value,
          args: [],
          error: new Just(new HeadNotIdent(span2.start))
        };
      }
      ;
      if (otherwise) {
        var v1 = parseExpr(partialHead(v.value0));
        if (v1 instanceof Right && v1.value0 instanceof App2) {
          return {
            name: new Just(v1.value0.value0),
            args: v1.value0.value1,
            error: Nothing.value
          };
        }
        ;
        if (v1 instanceof Right) {
          return {
            name: Nothing.value,
            args: [],
            error: new Just(new HeadNotIdent(span2.start))
          };
        }
        ;
        if (v1 instanceof Left) {
          return {
            name: salvageName(partialHead(v.value0)),
            args: [],
            error: new Just(v1.value0)
          };
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Parser (line 369, column 20 - line 372, column 84): " + [v1.constructor.name]);
      }
      ;
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 365, column 25 - line 372, column 84): " + [v.constructor.name]);
  };
};
var headed = function(span2) {
  return function(v) {
    if (v instanceof Left) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Right) {
      if ($$null(v.value0)) {
        return new Left(new HeadNotIdent(span2.start));
      }
      ;
      if (otherwise) {
        var v1 = parseExpr(partialHead(v.value0));
        if (v1 instanceof Left) {
          return new Left(v1.value0);
        }
        ;
        if (v1 instanceof Right && v1.value0 instanceof App2) {
          return new Right({
            name: v1.value0.value0,
            args: v1.value0.value1
          });
        }
        ;
        if (v1 instanceof Right) {
          return new Left(new HeadNotIdent(span2.start));
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Parser (line 328, column 20 - line 331, column 50): " + [v1.constructor.name]);
      }
      ;
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 324, column 15 - line 331, column 50): " + [v.constructor.name]);
  };
};
var parseSeq = function(gates) {
  return function(toks) {
    var done = function(acc) {
      return function(errs) {
        return function(stop) {
          return {
            nodes: fromFoldable4(reverse2(acc)),
            stop,
            errors: errs
          };
        };
      };
    };
    var recover = function(acc) {
      return function(errs) {
        return function(sp) {
          return function(e) {
            return function(next) {
              return go(new Cons(new NodeError(sp, parseErrorMessage(e)), acc))(snoc(errs)(e))(next);
            };
          };
        };
      };
    };
    var go = function($copy_acc) {
      return function($copy_errs) {
        return function($copy_i) {
          var $tco_var_acc = $copy_acc;
          var $tco_var_errs = $copy_errs;
          var $tco_done = false;
          var $tco_result;
          function $tco_loop(acc, errs, i) {
            var v = index(toks)(i);
            if (v instanceof Nothing) {
              $tco_done = true;
              return done(acc)(errs)(StopEOF.value);
            }
            ;
            if (v instanceof Just) {
              if (v.value0 instanceof RContent) {
                $tco_var_acc = new Cons(new Content(v.value0.value0, v.value0.value1), acc);
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RComment) {
                $tco_var_acc = acc;
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RLongComment) {
                $tco_var_acc = acc;
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RSetDelim) {
                $tco_var_acc = acc;
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RError) {
                $tco_done = true;
                return recover(acc)(errs)(v.value0.value0)(v.value0.value1)(i + 1 | 0);
              }
              ;
              if (v.value0 instanceof ROutput) {
                var v1 = outputExpr(v.value0.value0)(v.value0.value3);
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                if (v1 instanceof Right) {
                  $tco_var_acc = new Cons(new Output(v.value0.value0, v1.value0), acc);
                  $tco_var_errs = errs;
                  $copy_i = i + 1 | 0;
                  return;
                }
                ;
                throw new Error("Failed pattern match at FlatBars.Parser (line 447, column 31 - line 449, column 57): " + [v1.constructor.name]);
              }
              ;
              if (v.value0 instanceof RAmp) {
                if (!gates.extras) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{& }} (unescaped output)", v.value0.value0.start))(i + 1 | 0);
                }
                ;
                if (otherwise) {
                  var v1 = outputExpr(v.value0.value0)(v.value0.value3);
                  if (v1 instanceof Left) {
                    $tco_done = true;
                    return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                  }
                  ;
                  if (v1 instanceof Right) {
                    $tco_var_acc = new Cons(new Output(v.value0.value0, v1.value0), acc);
                    $tco_var_errs = errs;
                    $copy_i = i + 1 | 0;
                    return;
                  }
                  ;
                  throw new Error("Failed pattern match at FlatBars.Parser (line 455, column 24 - line 457, column 61): " + [v1.constructor.name]);
                }
                ;
              }
              ;
              if (v.value0 instanceof RRaw) {
                if (v.value0.value1 && !gates.rawBlockHash) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{{{# }}}} (raw block)", v.value0.value0.start))(i + 1 | 0);
                }
                ;
                if (!v.value0.value1 && !gates.rawBlockHbs) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{{{ }}}} (raw block)", v.value0.value0.start))(i + 1 | 0);
                }
                ;
                if (otherwise) {
                  var v1 = headed(v.value0.value0)(v.value0.value4);
                  if (v1 instanceof Left) {
                    $tco_done = true;
                    return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                  }
                  ;
                  if (v1 instanceof Right) {
                    $tco_var_acc = new Cons(new RawBlock(v.value0.value0, v1.value0.name, v1.value0.args, v.value0.value5), acc);
                    $tco_var_errs = errs;
                    $copy_i = i + 1 | 0;
                    return;
                  }
                  ;
                  throw new Error("Failed pattern match at FlatBars.Parser (line 468, column 24 - line 470, column 80): " + [v1.constructor.name]);
                }
                ;
              }
              ;
              if (v.value0 instanceof RSep) {
                var v1 = headed(v.value0.value0)(v.value0.value3);
                if (v1 instanceof Right) {
                  $tco_var_acc = new Cons(new Sep(v.value0.value0, v1.value0.name, v1.value0.args), acc);
                  $tco_var_errs = errs;
                  $copy_i = i + 1 | 0;
                  return;
                }
                ;
                if (v1 instanceof Left && (v1.value0 instanceof HeadNotIdent && trim(v.value0.value2) !== "")) {
                  var v2 = outputExpr(v.value0.value0)(v.value0.value3);
                  if (v2 instanceof Left) {
                    $tco_done = true;
                    return recover(acc)(errs)(v.value0.value0)(v2.value0)(i + 1 | 0);
                  }
                  ;
                  if (v2 instanceof Right) {
                    $tco_var_acc = new Cons(new Output(v.value0.value0, v2.value0), acc);
                    $tco_var_errs = errs;
                    $copy_i = i + 1 | 0;
                    return;
                  }
                  ;
                  throw new Error("Failed pattern match at FlatBars.Parser (line 482, column 31 - line 484, column 65): " + [v2.constructor.name]);
                }
                ;
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                throw new Error("Failed pattern match at FlatBars.Parser (line 475, column 9 - line 485, column 52): " + [v1.constructor.name]);
              }
              ;
              if (v.value0 instanceof RClose) {
                var v1 = headed({
                  start: v.value0.value1,
                  end: v.value0.value1
                })(v.value0.value3);
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                if (v1 instanceof Right) {
                  $tco_done = true;
                  return done(acc)(errs)(new StopClose(v1.value0.name, i + 1 | 0));
                }
                ;
                throw new Error("Failed pattern match at FlatBars.Parser (line 486, column 33 - line 490, column 60): " + [v1.constructor.name]);
              }
              ;
              if (v.value0 instanceof ROpen) {
                if (eq32(v.value0.value1)(Inverse.value) && !gates.extras) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{^ }} (inverse block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq32(v.value0.value1)(Parent.value) && !gates.inheritance) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{< }} (parent block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq32(v.value0.value1)(BlockDef.value) && !gates.inheritance) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{$ }} (override block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq32(v.value0.value1)(Decorator.value) && !gates.decorators) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{#* }} (inline-partial decorator)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq32(v.value0.value1)(PartialBlock.value) && !gates.partialBlocks) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{#> }} (partial block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (otherwise) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(Nothing.value)(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Parser (line 439, column 15 - line 525, column 74): " + [v.value0.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Parser (line 437, column 19 - line 525, column 74): " + [v.constructor.name]);
          }
          ;
          while (!$tco_done) {
            $tco_result = $tco_loop($tco_var_acc, $tco_var_errs, $copy_i);
          }
          ;
          return $tco_result;
        };
      };
    };
    var buildBlock = function(acc) {
      return function(errs) {
        return function(gateErr) {
          return function(span2) {
            return function(sigil) {
              return function(interior) {
                return function(i) {
                  var hr = headedRecovering(span2)(interior);
                  var errs1 = append3(errs)(catMaybes([gateErr, hr.error]));
                  if (hr.name instanceof Nothing) {
                    return go(new Cons(new NodeError(span2, maybe("parse error")(parseErrorMessage)(hr.error)), acc))(errs1)(i);
                  }
                  ;
                  if (hr.name instanceof Just) {
                    var inner = parseSeq(gates)(toks)(i);
                    var node2 = new Block(span2, sigil, hr.name.value0, hr.args, inner.nodes);
                    var errs2 = append3(errs1)(inner.errors);
                    if (inner.stop instanceof StopEOF) {
                      return go(new Cons(node2, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, "<eof>", span2.start)))(length(toks));
                    }
                    ;
                    if (inner.stop instanceof StopClose) {
                      if (inner.stop.value0 === hr.name.value0) {
                        return go(new Cons(node2, acc))(errs2)(inner.stop.value1);
                      }
                      ;
                      if (otherwise) {
                        return go(new Cons(node2, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, inner.stop.value0, span2.start)))(inner.stop.value1);
                      }
                      ;
                    }
                    ;
                    throw new Error("Failed pattern match at FlatBars.Parser (line 555, column 13 - line 565, column 24): " + [inner.stop.constructor.name]);
                  }
                  ;
                  throw new Error("Failed pattern match at FlatBars.Parser (line 546, column 7 - line 565, column 24): " + [hr.name.constructor.name]);
                };
              };
            };
          };
        };
      };
    };
    return go(Nil.value)([]);
  };
};
var gatesOf = function(opts) {
  return {
    extras: opts.extras,
    inheritance: opts.inheritance,
    decorators: opts.decorators,
    partialBlocks: opts.partialBlocks,
    rawBlockHbs: opts.rawBlockHbs,
    rawBlockHash: opts.rawBlockHash
  };
};
var effectiveTrim = function(opts) {
  return function(directives) {
    var v = find2(function(d) {
      return d.key === "trim";
    })(directives);
    if (v instanceof Nothing) {
      return new Right(opts.trimStandalone);
    }
    ;
    if (v instanceof Just) {
      if (v.value0.value === "standalone") {
        return new Right(true);
      }
      ;
      if (v.value0.value === "none") {
        return new Right(false);
      }
      ;
      return new Left(new BadDirective("invalid @trim value '" + (v.value0.value + "'; expected 'standalone' or 'none'"), v.value0.span.start));
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 207, column 33 - line 215, column 8): " + [v.constructor.name]);
  };
};
var defaultParseOptions = {
  trimStandalone: true,
  extras: true,
  inheritance: false,
  decorators: true,
  partialBlocks: true,
  rawBlockHbs: true,
  rawBlockHash: false,
  standaloneSeps: ["else", "elif"],
  lexConfig: defaultLexConfig
};
var collectDirectives = function(toks) {
  var go = function($copy_i) {
    return function($copy_headerOpen) {
      return function($copy_acc) {
        var $tco_var_i = $copy_i;
        var $tco_var_headerOpen = $copy_headerOpen;
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i, headerOpen, acc) {
          var v = index(toks)(i);
          if (v instanceof Nothing) {
            $tco_done = true;
            return new Right(acc);
          }
          ;
          if (v instanceof Just && v.value0 instanceof RComment) {
            var dirs = parseDirectives(v.value0.value1)(v.value0.value2);
            if (headerOpen) {
              $tco_var_i = i + 1 | 0;
              $tco_var_headerOpen = true;
              $copy_acc = append3(acc)(dirs);
              return;
            }
            ;
            var v1 = head(dirs);
            if (v1 instanceof Just) {
              $tco_done = true;
              return new Left(new DirectiveAfterHeader(v1.value0.span.start));
            }
            ;
            if (v1 instanceof Nothing) {
              $tco_var_i = i + 1 | 0;
              $tco_var_headerOpen = false;
              $copy_acc = acc;
              return;
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Parser (line 238, column 14 - line 240, column 42): " + [v1.constructor.name]);
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent) {
            $tco_var_i = i + 1 | 0;
            $tco_var_headerOpen = headerOpen;
            $copy_acc = acc;
            return;
          }
          ;
          if (v instanceof Just) {
            $tco_var_i = i + 1 | 0;
            $tco_var_headerOpen = false;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Parser (line 231, column 25 - line 242, column 35): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($tco_var_i, $tco_var_headerOpen, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
  };
  return go(0)(true)([]);
};
var parseRecovering = function(opts) {
  return function(src) {
    var runSeq = function($copy_toks) {
      return function($copy_idx) {
        return function($copy_accNodes) {
          return function($copy_accErrs) {
            var $tco_var_toks = $copy_toks;
            var $tco_var_idx = $copy_idx;
            var $tco_var_accNodes = $copy_accNodes;
            var $tco_done = false;
            var $tco_result;
            function $tco_loop(toks, idx, accNodes, accErrs) {
              var r = parseSeq(gatesOf(opts))(toks)(idx);
              var nodes$prime = append3(accNodes)(r.nodes);
              var errs$prime = append3(accErrs)(r.errors);
              if (r.stop instanceof StopEOF) {
                $tco_done = true;
                return {
                  nodes: nodes$prime,
                  errors: errs$prime
                };
              }
              ;
              if (r.stop instanceof StopClose) {
                $tco_var_toks = toks;
                $tco_var_idx = r.stop.value1;
                $tco_var_accNodes = nodes$prime;
                $copy_accErrs = snoc(errs$prime)(new MismatchedBlock("<none>", r.stop.value0, 0));
                return;
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Parser (line 151, column 7 - line 154, column 63): " + [r.stop.constructor.name]);
            }
            ;
            while (!$tco_done) {
              $tco_result = $tco_loop($tco_var_toks, $tco_var_idx, $tco_var_accNodes, $copy_accErrs);
            }
            ;
            return $tco_result;
          };
        };
      };
    };
    var v = tokenizeTemplate(opts.lexConfig)(src);
    if (v instanceof Left) {
      return {
        directives: [],
        nodes: [],
        errors: [v.value0]
      };
    }
    ;
    if (v instanceof Right) {
      var dirRes = collectDirectives(v.value0);
      var directives = either($$const([]))(identity8)(dirRes);
      var trimRes = effectiveTrim(opts)(directives);
      var standalone = either($$const(false))(identity8)(trimRes);
      var toks$prime = (function() {
        if (standalone) {
          return trimStandalone(opts.standaloneSeps)(v.value0);
        }
        ;
        return v.value0;
      })();
      var filtered = filter(function($175) {
        return !isComment($175);
      })(toks$prime);
      var seq = runSeq(filtered)(0)([])([]);
      var trimErrs = either(singleton2)($$const([]))(trimRes);
      var dirErrs = either(singleton2)($$const([]))(dirRes);
      return {
        directives,
        nodes: seq.nodes,
        errors: append3(dirErrs)(append3(trimErrs)(seq.errors))
      };
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 116, column 28 - line 135, column 82): " + [v.constructor.name]);
  };
};
var parseWith = function(opts) {
  return function(src) {
    var r = parseRecovering(opts)(src);
    var v = fromArray(r.errors);
    if (v instanceof Just) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Nothing) {
      return new Right({
        directives: r.directives,
        nodes: r.nodes
      });
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 168, column 5 - line 170, column 68): " + [v.constructor.name]);
  };
};
var parse = /* @__PURE__ */ parseWith(defaultParseOptions);
var buildFromTokens = function(opts) {
  return function(toks) {
    var r = parseSeq(gatesOf(opts))(filter(function($176) {
      return !isComment($176);
    })(toks))(0);
    var v = fromArray(r.errors);
    if (v instanceof Just) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Nothing) {
      if (r.stop instanceof StopEOF) {
        return new Right(r.nodes);
      }
      ;
      if (r.stop instanceof StopClose) {
        return new Left(singleton6(new MismatchedBlock("<none>", r.stop.value0, 0)));
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Parser (line 192, column 18 - line 194, column 83): " + [r.stop.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 190, column 5 - line 194, column 83): " + [v.constructor.name]);
  };
};

// output/Data.String.CodePoints/foreign.js
var hasArrayFrom = typeof Array.from === "function";
var hasStringIterator = typeof Symbol !== "undefined" && Symbol != null && typeof Symbol.iterator !== "undefined" && typeof String.prototype[Symbol.iterator] === "function";
var hasFromCodePoint = typeof String.prototype.fromCodePoint === "function";
var hasCodePointAt = typeof String.prototype.codePointAt === "function";
var _unsafeCodePointAt0 = function(fallback) {
  return hasCodePointAt ? function(str2) {
    return str2.codePointAt(0);
  } : fallback;
};
var _singleton = function(fallback) {
  return hasFromCodePoint ? String.fromCodePoint : fallback;
};
var _take = function(fallback) {
  return function(n) {
    if (hasStringIterator) {
      return function(str2) {
        var accum = "";
        var iter = str2[Symbol.iterator]();
        for (var i = 0; i < n; ++i) {
          var o = iter.next();
          if (o.done) return accum;
          accum += o.value;
        }
        return accum;
      };
    }
    return fallback(n);
  };
};
var _toCodePointArray = function(fallback) {
  return function(unsafeCodePointAt02) {
    if (hasArrayFrom) {
      return function(str2) {
        return Array.from(str2, unsafeCodePointAt02);
      };
    }
    return fallback;
  };
};

// output/Data.Enum/foreign.js
function toCharCode(c) {
  return c.charCodeAt(0);
}
function fromCharCode(c) {
  return String.fromCharCode(c);
}

// output/Data.Enum/index.js
var bottom1 = /* @__PURE__ */ bottom(boundedChar);
var top1 = /* @__PURE__ */ top(boundedChar);
var toEnum = function(dict) {
  return dict.toEnum;
};
var fromEnum = function(dict) {
  return dict.fromEnum;
};
var toEnumWithDefaults = function(dictBoundedEnum) {
  var toEnum1 = toEnum(dictBoundedEnum);
  var fromEnum1 = fromEnum(dictBoundedEnum);
  var bottom22 = bottom(dictBoundedEnum.Bounded0());
  return function(low) {
    return function(high) {
      return function(x) {
        var v = toEnum1(x);
        if (v instanceof Just) {
          return v.value0;
        }
        ;
        if (v instanceof Nothing) {
          var $140 = x < fromEnum1(bottom22);
          if ($140) {
            return low;
          }
          ;
          return high;
        }
        ;
        throw new Error("Failed pattern match at Data.Enum (line 158, column 33 - line 160, column 62): " + [v.constructor.name]);
      };
    };
  };
};
var defaultSucc = function(toEnum$prime) {
  return function(fromEnum$prime) {
    return function(a) {
      return toEnum$prime(fromEnum$prime(a) + 1 | 0);
    };
  };
};
var defaultPred = function(toEnum$prime) {
  return function(fromEnum$prime) {
    return function(a) {
      return toEnum$prime(fromEnum$prime(a) - 1 | 0);
    };
  };
};
var charToEnum = function(v) {
  if (v >= toCharCode(bottom1) && v <= toCharCode(top1)) {
    return new Just(fromCharCode(v));
  }
  ;
  return Nothing.value;
};
var enumChar = {
  succ: /* @__PURE__ */ defaultSucc(charToEnum)(toCharCode),
  pred: /* @__PURE__ */ defaultPred(charToEnum)(toCharCode),
  Ord0: function() {
    return ordChar;
  }
};
var boundedEnumChar = /* @__PURE__ */ (function() {
  return {
    cardinality: toCharCode(top1) - toCharCode(bottom1) | 0,
    toEnum: charToEnum,
    fromEnum: toCharCode,
    Bounded0: function() {
      return boundedChar;
    },
    Enum1: function() {
      return enumChar;
    }
  };
})();

// output/Data.String.CodePoints/index.js
var fromEnum2 = /* @__PURE__ */ fromEnum(boundedEnumChar);
var map10 = /* @__PURE__ */ map(functorMaybe);
var unfoldr2 = /* @__PURE__ */ unfoldr(unfoldableArray);
var div3 = /* @__PURE__ */ div(euclideanRingInt);
var mod3 = /* @__PURE__ */ mod(euclideanRingInt);
var unsurrogate = function(lead) {
  return function(trail) {
    return (((lead - 55296 | 0) * 1024 | 0) + (trail - 56320 | 0) | 0) + 65536 | 0;
  };
};
var isTrail = function(cu) {
  return 56320 <= cu && cu <= 57343;
};
var isLead = function(cu) {
  return 55296 <= cu && cu <= 56319;
};
var uncons4 = function(s) {
  var v = length2(s);
  if (v === 0) {
    return Nothing.value;
  }
  ;
  if (v === 1) {
    return new Just({
      head: fromEnum2(charAt(0)(s)),
      tail: ""
    });
  }
  ;
  var cu1 = fromEnum2(charAt(1)(s));
  var cu0 = fromEnum2(charAt(0)(s));
  var $43 = isLead(cu0) && isTrail(cu1);
  if ($43) {
    return new Just({
      head: unsurrogate(cu0)(cu1),
      tail: drop2(2)(s)
    });
  }
  ;
  return new Just({
    head: cu0,
    tail: drop2(1)(s)
  });
};
var unconsButWithTuple = function(s) {
  return map10(function(v) {
    return new Tuple(v.head, v.tail);
  })(uncons4(s));
};
var toCodePointArrayFallback = function(s) {
  return unfoldr2(unconsButWithTuple)(s);
};
var unsafeCodePointAt0Fallback = function(s) {
  var cu0 = fromEnum2(charAt(0)(s));
  var $47 = isLead(cu0) && length2(s) > 1;
  if ($47) {
    var cu1 = fromEnum2(charAt(1)(s));
    var $48 = isTrail(cu1);
    if ($48) {
      return unsurrogate(cu0)(cu1);
    }
    ;
    return cu0;
  }
  ;
  return cu0;
};
var unsafeCodePointAt0 = /* @__PURE__ */ _unsafeCodePointAt0(unsafeCodePointAt0Fallback);
var toCodePointArray = /* @__PURE__ */ _toCodePointArray(toCodePointArrayFallback)(unsafeCodePointAt0);
var length3 = function($74) {
  return length(toCodePointArray($74));
};
var lastIndexOf2 = function(p) {
  return function(s) {
    return map10(function(i) {
      return length3(take2(i)(s));
    })(lastIndexOf(p)(s));
  };
};
var indexOf2 = function(p) {
  return function(s) {
    return map10(function(i) {
      return length3(take2(i)(s));
    })(indexOf(p)(s));
  };
};
var fromCharCode2 = /* @__PURE__ */ (function() {
  var $75 = toEnumWithDefaults(boundedEnumChar)(bottom(boundedChar))(top(boundedChar));
  return function($76) {
    return singleton5($75($76));
  };
})();
var singletonFallback = function(v) {
  if (v <= 65535) {
    return fromCharCode2(v);
  }
  ;
  var lead = div3(v - 65536 | 0)(1024) + 55296 | 0;
  var trail = mod3(v - 65536 | 0)(1024) + 56320 | 0;
  return fromCharCode2(lead) + fromCharCode2(trail);
};
var singleton7 = /* @__PURE__ */ _singleton(singletonFallback);
var takeFallback = function(v) {
  return function(v1) {
    if (v < 1) {
      return "";
    }
    ;
    var v2 = uncons4(v1);
    if (v2 instanceof Just) {
      return singleton7(v2.value0.head) + takeFallback(v - 1 | 0)(v2.value0.tail);
    }
    ;
    return v1;
  };
};
var take3 = /* @__PURE__ */ _take(takeFallback);
var drop3 = function(n) {
  return function(s) {
    return drop2(length2(take3(n)(s)))(s);
  };
};

// output/Kernel.Walk/index.js
var map11 = /* @__PURE__ */ map(functorMaybe);
var map12 = /* @__PURE__ */ map(functorArray);
var fold2 = /* @__PURE__ */ fold(foldableArray);
var foldMap2 = /* @__PURE__ */ foldMap(foldableArray);
var show3 = /* @__PURE__ */ show(showInt);
var Err = /* @__PURE__ */ (function() {
  function Err2() {
  }
  ;
  Err2.value = new Err2();
  return Err2;
})();
var Warn = /* @__PURE__ */ (function() {
  function Warn2() {
  }
  ;
  Warn2.value = new Warn2();
  return Warn2;
})();
var AppRef = /* @__PURE__ */ (function() {
  function AppRef2() {
  }
  ;
  AppRef2.value = new AppRef2();
  return AppRef2;
})();
var BlockRef = /* @__PURE__ */ (function() {
  function BlockRef2() {
  }
  ;
  BlockRef2.value = new BlockRef2();
  return BlockRef2;
})();
var RawRef = /* @__PURE__ */ (function() {
  function RawRef2() {
  }
  ;
  RawRef2.value = new RawRef2();
  return RawRef2;
})();
var SepRef = /* @__PURE__ */ (function() {
  function SepRef2() {
  }
  ;
  SepRef2.value = new SepRef2();
  return SepRef2;
})();
var Exactly = /* @__PURE__ */ (function() {
  function Exactly2(value0) {
    this.value0 = value0;
  }
  ;
  Exactly2.create = function(value0) {
    return new Exactly2(value0);
  };
  return Exactly2;
})();
var AtLeast = /* @__PURE__ */ (function() {
  function AtLeast2(value0) {
    this.value0 = value0;
  }
  ;
  AtLeast2.create = function(value0) {
    return new AtLeast2(value0);
  };
  return AtLeast2;
})();
var Between = /* @__PURE__ */ (function() {
  function Between2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  Between2.create = function(value0) {
    return function(value1) {
      return new Between2(value0, value1);
    };
  };
  return Between2;
})();
var AnyArity = /* @__PURE__ */ (function() {
  function AnyArity2() {
  }
  ;
  AnyArity2.value = new AnyArity2();
  return AnyArity2;
})();
var splitClauses = function(nodes) {
  var isSep = function(v2) {
    if (v2 instanceof Sep) {
      return true;
    }
    ;
    return false;
  };
  var clausesFrom = function(rest) {
    var v2 = uncons(rest);
    if (v2 instanceof Just && v2.value0.head instanceof Sep) {
      var bodyEnd = fromMaybe(length(v2.value0.tail))(findIndex(isSep)(v2.value0.tail));
      return cons({
        name: v2.value0.head.value1,
        args: v2.value0.head.value2,
        body: take(bodyEnd)(v2.value0.tail),
        span: v2.value0.head.value0
      })(clausesFrom(drop(bodyEnd)(v2.value0.tail)));
    }
    ;
    return [];
  };
  var v = findIndex(isSep)(nodes);
  if (v instanceof Nothing) {
    return {
      before: nodes,
      clauses: []
    };
  }
  ;
  if (v instanceof Just) {
    return {
      before: take(v.value0)(nodes),
      clauses: clausesFrom(drop(v.value0)(nodes))
    };
  }
  ;
  throw new Error("Failed pattern match at Kernel.Walk (line 187, column 22 - line 189, column 86): " + [v.constructor.name]);
};
var splitClause = function(name2) {
  return function(nodes) {
    var s = splitClauses(nodes);
    return {
      before: s.before,
      clause: map11(function(v) {
        return v.body;
      })(find2(function(c) {
        return c.name === name2;
      })(s.clauses))
    };
  };
};
var showSeverity = {
  show: function(v) {
    if (v instanceof Err) {
      return "error";
    }
    ;
    if (v instanceof Warn) {
      return "warning";
    }
    ;
    throw new Error("Failed pattern match at Kernel.Walk (line 248, column 10 - line 250, column 22): " + [v.constructor.name]);
  }
};
var foldTemplate = function(alg) {
  var node2 = function(v) {
    if (v instanceof Content) {
      return alg.content(v.value0)(v.value1);
    }
    ;
    if (v instanceof Output) {
      return alg.output(v.value0)(v.value1);
    }
    ;
    if (v instanceof RawBlock) {
      return alg.raw(v.value0)(v.value1)(v.value2)(v.value3);
    }
    ;
    if (v instanceof Sep) {
      return alg.sep(v.value0)(v.value1)(v.value2);
    }
    ;
    if (v instanceof Block) {
      return alg.block({
        span: v.value0,
        name: v.value2,
        args: v.value3,
        children: v.value4,
        recurse: go
      });
    }
    ;
    if (v instanceof NodeError) {
      return alg.nodeError(v.value0)(v.value1);
    }
    ;
    throw new Error("Failed pattern match at Kernel.Walk (line 161, column 10 - line 167, column 49): " + [v.constructor.name]);
  };
  var go = function(nodes) {
    return alg.concat(map12(node2)(nodes));
  };
  return go;
};
var foldExpr = function(alg) {
  var go = function(v) {
    if (v instanceof Lit) {
      return alg.lit(v.value0);
    }
    ;
    if (v instanceof App2) {
      return alg.app(v.value0)(map12(go)(v.value1));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Walk (line 86, column 8 - line 88, column 48): " + [v.constructor.name]);
  };
  return go;
};
var foldRefs = function(dictMonoid) {
  var mempty2 = mempty(dictMonoid);
  var append110 = append(dictMonoid.Semigroup0());
  var fold12 = fold2(dictMonoid);
  var foldMap12 = foldMap2(dictMonoid);
  return function(f) {
    var expr = function(g) {
      return function(sp) {
        return foldExpr({
          lit: function(v) {
            return mempty2;
          },
          app: function(name2) {
            return function(children) {
              return append110(g({
                name: name2,
                kind: AppRef.value,
                argc: length(children),
                span: sp
              }))(fold12(children));
            };
          }
        });
      };
    };
    var node2 = function(g) {
      return function(v) {
        if (v instanceof Content) {
          return mempty2;
        }
        ;
        if (v instanceof Output) {
          return expr(g)(v.value0)(v.value1);
        }
        ;
        if (v instanceof Block) {
          return append110(g({
            name: v.value2,
            kind: BlockRef.value,
            argc: length(v.value3),
            span: v.value0
          }))(append110(foldMap12(expr(g)(v.value0))(v.value3))(foldRefs(dictMonoid)(g)(v.value4)));
        }
        ;
        if (v instanceof RawBlock) {
          return append110(g({
            name: v.value1,
            kind: RawRef.value,
            argc: length(v.value2),
            span: v.value0
          }))(foldMap12(expr(g)(v.value0))(v.value2));
        }
        ;
        if (v instanceof Sep) {
          return append110(g({
            name: v.value1,
            kind: SepRef.value,
            argc: length(v.value2),
            span: v.value0
          }))(foldMap12(expr(g)(v.value0))(v.value2));
        }
        ;
        if (v instanceof NodeError) {
          return mempty2;
        }
        ;
        throw new Error("Failed pattern match at Kernel.Walk (line 95, column 12 - line 106, column 28): " + [v.constructor.name]);
      };
    };
    return foldMap12(node2(f));
  };
};
var operationRefs = /* @__PURE__ */ foldRefs(monoidArray)(singleton2);
var arityText2 = function(v) {
  if (v instanceof Exactly) {
    return "exactly " + show3(v.value0);
  }
  ;
  if (v instanceof AtLeast) {
    return "at least " + show3(v.value0);
  }
  ;
  if (v instanceof Between) {
    return show3(v.value0) + ("\u2013" + show3(v.value1));
  }
  ;
  if (v instanceof AnyArity) {
    return "any number of";
  }
  ;
  throw new Error("Failed pattern match at Kernel.Walk (line 262, column 13 - line 266, column 30): " + [v.constructor.name]);
};
var arityOk2 = function(a) {
  return function(n) {
    if (a instanceof Exactly) {
      return n === a.value0;
    }
    ;
    if (a instanceof AtLeast) {
      return n >= a.value0;
    }
    ;
    if (a instanceof Between) {
      return n >= a.value0 && n <= a.value1;
    }
    ;
    if (a instanceof AnyArity) {
      return true;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Walk (line 255, column 15 - line 259, column 19): " + [a.constructor.name]);
  };
};

// output/Kernel.Engine/index.js
var traverse2 = /* @__PURE__ */ traverse(traversableArray);
var traverse12 = /* @__PURE__ */ traverse(traversableMaybe);
var runTemplate = function(dictMonad) {
  var Bind1 = dictMonad.Bind1();
  var Apply0 = Bind1.Apply0();
  var map37 = map(Apply0.Functor0());
  var Applicative0 = dictMonad.Applicative0();
  var traverse22 = traverse2(Applicative0);
  var applySecond2 = applySecond(Apply0);
  var pure19 = pure(Applicative0);
  var bind20 = bind(Bind1);
  var traverse32 = traverse12(Applicative0);
  return function(engine) {
    var renderTemplate = function(env) {
      return function(nodes) {
        return map37(joinWith(""))(traverse22(renderNode(env))(nodes));
      };
    };
    var renderNode = function(env) {
      return function(v) {
        if (v instanceof Content) {
          return applySecond2(engine.recordText(env)(v.value0)(v.value1))(pure19(v.value1));
        }
        ;
        if (v instanceof Output) {
          return engine.recordEmit(env)(v.value0)(bind20(evalExpr(env)(v.value0)(v.value1))(engine.stringify));
        }
        ;
        if (v instanceof Block) {
          return applyBlock(engine.resolve)(env)(v.value0)(v.value2)(v.value3)(v.value4);
        }
        ;
        if (v instanceof RawBlock) {
          return applyBlock(engine.resolveStrict)(env)(v.value0)(v.value1)(v.value2)([new Content(v.value0, v.value3)]);
        }
        ;
        if (v instanceof Sep) {
          return engine.recordEmit(env)(v.value0)(bind20(evalExpr(env)(v.value0)(new App2(v.value1, v.value2)))(engine.stringify));
        }
        ;
        if (v instanceof NodeError) {
          return pure19("");
        }
        ;
        throw new Error("Failed pattern match at Kernel.Engine (line 106, column 20 - line 126, column 29): " + [v.constructor.name]);
      };
    };
    var evalExpr = function(env) {
      return function(span2) {
        return function(v) {
          if (v instanceof Lit) {
            return pure19(v.value0);
          }
          ;
          if (v instanceof App2) {
            return bind20(traverse22(evalExpr(env)(span2))(v.value1))(function(vals) {
              return bind20(engine.resolve(env)(v.value0))(function(h) {
                return h(ctl(env)([])(span2)(Nothing.value)([])(Nothing.value))(vals);
              });
            });
          }
          ;
          throw new Error("Failed pattern match at Kernel.Engine (line 144, column 23 - line 149, column 50): " + [v.constructor.name]);
        };
      };
    };
    var ctl = function(env) {
      return function(body) {
        return function(span2) {
          return function(hashV) {
            return function(params) {
              return function(label) {
                return {
                  env,
                  children: body,
                  span: span2,
                  render: renderTemplate,
                  "eval": function(env$prime) {
                    return function(e) {
                      return evalExpr(env$prime)(span2)(e);
                    };
                  },
                  clause: function(name2) {
                    var s = splitClause(name2)(body);
                    return {
                      before: s.before,
                      body: s.clause
                    };
                  },
                  hash: hashV,
                  blockParams: params,
                  loopLabel: label
                };
              };
            };
          };
        };
      };
    };
    var applyBlock = function(resolve) {
      return function(env) {
        return function(span2) {
          return function(name2) {
            return function(args) {
              return function(body) {
                var split2 = engine.blockArgs(args);
                return bind20(traverse22(evalExpr(env)(span2))(split2.positional))(function(vals) {
                  return bind20(traverse32(evalExpr(env)(span2))(split2.hash))(function(hashV) {
                    return bind20(resolve(env)(name2))(function(h) {
                      return bind20(h(ctl(env)(body)(span2)(hashV)(split2.params)(split2.label))(vals))(engine.stringify);
                    });
                  });
                });
              };
            };
          };
        };
      };
    };
    return renderTemplate(engine.initial);
  };
};

// output/Data.Char/index.js
var toCharCode2 = /* @__PURE__ */ fromEnum(boundedEnumChar);

// output/Kernel.Value/index.js
var show4 = /* @__PURE__ */ show(showNumber);
var map13 = /* @__PURE__ */ map(functorEither);
var traverse3 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var foldMap3 = /* @__PURE__ */ foldMap(foldableArray)(monoidString);
var map14 = /* @__PURE__ */ map(functorArray);
var power2 = /* @__PURE__ */ power(monoidString);
var toUnfoldable4 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var presence = function(v) {
  if (v instanceof VBool) {
    return v.value0;
  }
  ;
  if (v instanceof VNull) {
    return false;
  }
  ;
  if (v instanceof VArray) {
    return !$$null(v.value0);
  }
  ;
  if (v instanceof VObject) {
    return !isEmpty(v.value0);
  }
  ;
  return true;
};
var numberToString = function(n) {
  var s = show4(n);
  return fromMaybe(s)(stripSuffix(".0")(s));
};
var stringify = function(v) {
  if (v instanceof VString) {
    return new Right(v.value0);
  }
  ;
  if (v instanceof VSafe) {
    return new Right(v.value0);
  }
  ;
  if (v instanceof VBool) {
    return new Right((function() {
      if (v.value0) {
        return "true";
      }
      ;
      return "false";
    })());
  }
  ;
  if (v instanceof VNull) {
    return new Right("");
  }
  ;
  if (v instanceof VNumber) {
    return new Right(numberToString(v.value0));
  }
  ;
  if (v instanceof VArray) {
    return map13(joinWith(","))(traverse3(stringify)(v.value0));
  }
  ;
  if (v instanceof VObject) {
    return new Left(new $$TypeError("cannot stringify an object"));
  }
  ;
  throw new Error("Failed pattern match at Kernel.Value (line 137, column 13 - line 144, column 61): " + [v.constructor.name]);
};
var nonEmpty = function(v) {
  if (v instanceof VBool) {
    return v.value0;
  }
  ;
  if (v instanceof VNull) {
    return false;
  }
  ;
  if (v instanceof VString) {
    return v.value0 !== "";
  }
  ;
  if (v instanceof VSafe) {
    return v.value0 !== "";
  }
  ;
  if (v instanceof VArray) {
    return !$$null(v.value0);
  }
  ;
  if (v instanceof VObject) {
    return !isEmpty(v.value0);
  }
  ;
  if (v instanceof VNumber) {
    return true;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Value (line 95, column 12 - line 102, column 20): " + [v.constructor.name]);
};
var mustache = function(v) {
  if (v instanceof VBool) {
    return v.value0;
  }
  ;
  if (v instanceof VNull) {
    return false;
  }
  ;
  if (v instanceof VArray) {
    return !$$null(v.value0);
  }
  ;
  return true;
};
var minimal = function(v) {
  if (v instanceof VBool) {
    return v.value0;
  }
  ;
  if (v instanceof VNull) {
    return false;
  }
  ;
  return true;
};
var jsonQuote = function(s) {
  var pad2 = function(h) {
    var $49 = length3(h) === 1;
    if ($49) {
      return "0" + h;
    }
    ;
    return h;
  };
  var esc = function(c) {
    if (c === '"') {
      return '\\"';
    }
    ;
    if (c === "\\") {
      return "\\\\";
    }
    ;
    if (c === "\n") {
      return "\\n";
    }
    ;
    if (c === "\r") {
      return "\\r";
    }
    ;
    if (c === "	") {
      return "\\t";
    }
    ;
    var code = toCharCode2(c);
    var $51 = code < 32;
    if ($51) {
      return "\\u00" + pad2(toStringAs(hexadecimal)(code));
    }
    ;
    return singleton5(c);
  };
  return '"' + (foldMap3(esc)(toCharArray(s)) + '"');
};
var renderJson = function(mIndent) {
  return function(depth) {
    var container = function(open) {
      return function(close) {
        return function(items) {
          if ($$null(items)) {
            return open + close;
          }
          ;
          if (mIndent instanceof Nothing) {
            return open + (joinWith(",")(items) + close);
          }
          ;
          if (mIndent instanceof Just) {
            return open + ("\n" + (joinWith(",\n")(map14(function(it) {
              return power2(mIndent.value0)(depth + 1 | 0) + it;
            })(items)) + ("\n" + (power2(mIndent.value0)(depth) + close))));
          }
          ;
          throw new Error("Failed pattern match at Kernel.Value (line 193, column 32 - line 201, column 17): " + [mIndent.constructor.name]);
        };
      };
    };
    var colon = (function() {
      if (mIndent instanceof Just) {
        return ": ";
      }
      ;
      if (mIndent instanceof Nothing) {
        return ":";
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 188, column 11 - line 190, column 19): " + [mIndent.constructor.name]);
    })();
    var member7 = function(v) {
      return jsonQuote(v.value0) + (colon + renderJson(mIndent)(depth + 1 | 0)(v.value1));
    };
    return function(v) {
      if (v instanceof VNull) {
        return "null";
      }
      ;
      if (v instanceof VBool) {
        if (v.value0) {
          return "true";
        }
        ;
        return "false";
      }
      ;
      if (v instanceof VNumber) {
        return numberToString(v.value0);
      }
      ;
      if (v instanceof VString) {
        return jsonQuote(v.value0);
      }
      ;
      if (v instanceof VSafe) {
        return jsonQuote(v.value0);
      }
      ;
      if (v instanceof VArray) {
        return container("[")("]")(map14(renderJson(mIndent)(depth + 1 | 0))(v.value0));
      }
      ;
      if (v instanceof VObject) {
        return container("{")("}")(map14(member7)(toUnfoldable4(v.value0)));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 176, column 28 - line 185, column 70): " + [v.constructor.name]);
    };
  };
};
var jsonStringify = /* @__PURE__ */ (function() {
  return renderJson(Nothing.value)(0);
})();
var jsonStringifyPretty = /* @__PURE__ */ (function() {
  return renderJson(new Just("  "))(0);
})();
var handlebars = function($copy_v) {
  var $tco_done = false;
  var $tco_result;
  function $tco_loop(v) {
    if (v instanceof VBool) {
      $tco_done = true;
      return v.value0;
    }
    ;
    if (v instanceof VNull) {
      $tco_done = true;
      return false;
    }
    ;
    if (v instanceof VString) {
      $tco_done = true;
      return v.value0 !== "";
    }
    ;
    if (v instanceof VNumber) {
      $tco_done = true;
      return v.value0 !== 0;
    }
    ;
    if (v instanceof VArray) {
      $tco_done = true;
      return !$$null(v.value0);
    }
    ;
    if (v instanceof VObject) {
      $tco_done = true;
      return true;
    }
    ;
    if (v instanceof VSafe) {
      $copy_v = new VString(v.value0);
      return;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Value (line 61, column 14 - line 68, column 36): " + [v.constructor.name]);
  }
  ;
  while (!$tco_done) {
    $tco_result = $tco_loop($copy_v);
  }
  ;
  return $tco_result;
};
var mustacheJs = handlebars;
var escapeHtml = /* @__PURE__ */ (function() {
  var $74 = replaceAll("'")("&#x27;");
  var $75 = replaceAll('"')("&quot;");
  var $76 = replaceAll(">")("&gt;");
  var $77 = replaceAll("<")("&lt;");
  var $78 = replaceAll("&")("&amp;");
  return function($79) {
    return $74($75($76($77($78($79)))));
  };
})();

// output/Kernel.Env/index.js
var lookup4 = /* @__PURE__ */ lookup2(ordString);
var union3 = /* @__PURE__ */ union(ordString);
var insert4 = /* @__PURE__ */ insert(ordString);
var foldl4 = /* @__PURE__ */ foldl(foldableArray);
var member2 = /* @__PURE__ */ member(ordString);
var withYieldName = function(n) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      truthy: v.truthy,
      translator: v.translator,
      depth: v.depth,
      currentFile: v.currentFile,
      partialFiles: v.partialFiles,
      yieldName: n
    };
  };
};
var withTruthy = function(tf) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      translator: v.translator,
      yieldName: v.yieldName,
      depth: v.depth,
      currentFile: v.currentFile,
      partialFiles: v.partialFiles,
      truthy: tf
    };
  };
};
var withTranslator = function(tr) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      truthy: v.truthy,
      yieldName: v.yieldName,
      depth: v.depth,
      currentFile: v.currentFile,
      partialFiles: v.partialFiles,
      translator: new Just(tr)
    };
  };
};
var withPartialFileScope = function(name2) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      truthy: v.truthy,
      translator: v.translator,
      yieldName: v.yieldName,
      depth: v.depth,
      partialFiles: v.partialFiles,
      currentFile: fromMaybe(name2)(lookup4(name2)(v.partialFiles))
    };
  };
};
var registerPartials = function(ps) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      truthy: v.truthy,
      translator: v.translator,
      yieldName: v.yieldName,
      depth: v.depth,
      currentFile: v.currentFile,
      partialFiles: v.partialFiles,
      partials: union3(ps)(v.partials)
    };
  };
};
var registerPartialFiles = function(fs) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      truthy: v.truthy,
      translator: v.translator,
      yieldName: v.yieldName,
      depth: v.depth,
      currentFile: v.currentFile,
      partialFiles: union3(fs)(v.partialFiles)
    };
  };
};
var register = function(name2) {
  return function(h) {
    return function(v) {
      if (v.helpers instanceof Nil) {
        return {
          context: v.context,
          partials: v.partials,
          truthy: v.truthy,
          translator: v.translator,
          yieldName: v.yieldName,
          depth: v.depth,
          currentFile: v.currentFile,
          partialFiles: v.partialFiles,
          helpers: new Cons(singleton4(name2)(h), Nil.value)
        };
      }
      ;
      if (v.helpers instanceof Cons) {
        return {
          context: v.context,
          partials: v.partials,
          truthy: v.truthy,
          translator: v.translator,
          yieldName: v.yieldName,
          depth: v.depth,
          currentFile: v.currentFile,
          partialFiles: v.partialFiles,
          helpers: new Cons(insert4(name2)(h)(v.helpers.value0), v.helpers.value1)
        };
      }
      ;
      throw new Error("Failed pattern match at Kernel.Env (line 168, column 37 - line 170, column 61): " + [v.helpers.constructor.name]);
    };
  };
};
var registerAll = function(pairs) {
  return function(env) {
    return foldl4(function(acc) {
      return function(v) {
        return register(v.value0)(v.value1)(acc);
      };
    })(env)(pairs);
  };
};
var refYieldName = function(v) {
  return v.yieldName;
};
var refTruthy = function(v) {
  return v.truthy;
};
var refTranslator = function(v) {
  return v.translator;
};
var refDepth = function(v) {
  return v.depth;
};
var refCurrentFile = function(v) {
  return v.currentFile;
};
var refContext = function(v) {
  return v.context;
};
var recursionBudget = 64;
var pushHelpers = function(frame) {
  return function(v) {
    return {
      context: v.context,
      partials: v.partials,
      truthy: v.truthy,
      translator: v.translator,
      yieldName: v.yieldName,
      depth: v.depth,
      currentFile: v.currentFile,
      partialFiles: v.partialFiles,
      helpers: new Cons(frame, v.helpers)
    };
  };
};
var pushFrame = function(frame) {
  return function(ctx2) {
    return function(v) {
      return {
        partials: v.partials,
        truthy: v.truthy,
        translator: v.translator,
        yieldName: v.yieldName,
        depth: v.depth,
        currentFile: v.currentFile,
        partialFiles: v.partialFiles,
        helpers: new Cons(frame, v.helpers),
        context: ctx2
      };
    };
  };
};
var lookupPartial = function(name2) {
  return function(v) {
    return lookup4(name2)(v.partials);
  };
};
var lookupOperation = function(name2) {
  return function(v) {
    var go = function($copy_v1) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(v1) {
        if (v1 instanceof Nil) {
          $tco_done = true;
          return Nothing.value;
        }
        ;
        if (v1 instanceof Cons) {
          var v2 = lookup4(name2)(v1.value0);
          if (v2 instanceof Just) {
            $tco_done = true;
            return new Just(v2.value0);
          }
          ;
          if (v2 instanceof Nothing) {
            $copy_v1 = v1.value1;
            return;
          }
          ;
          throw new Error("Failed pattern match at Kernel.Env (line 180, column 19 - line 182, column 23): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at Kernel.Env (line 179, column 3 - line 179, column 19): " + [v1.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_v1);
      }
      ;
      return $tco_result;
    };
    return go(v.helpers);
  };
};
var liftEither = function(dictMonadThrow) {
  return either(throwError(dictMonadThrow))(pure(dictMonadThrow.Monad0().Applicative0()));
};
var refEngineWith = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var pure19 = pure(dictMonadThrow.Monad0().Applicative0());
  var liftEither1 = liftEither(dictMonadThrow);
  return function(policy) {
    return function(initial) {
      return {
        initial,
        resolve: function(env) {
          return function(name2) {
            return policy(env)(name2)(lookupOperation(name2)(env));
          };
        },
        resolveStrict: function(env) {
          return function(name2) {
            return maybe(throwError3(new UnknownHelper(name2)))(pure19)(lookupOperation(name2)(env));
          };
        },
        stringify: function(v) {
          return liftEither1(stringify(v));
        },
        blockArgs: splitBlockArgs,
        recordText: function(v) {
          return function(v1) {
            return function(v2) {
              return pure19(unit);
            };
          };
        },
        recordEmit: function(v) {
          return function(v1) {
            return function(produce) {
              return produce;
            };
          };
        }
      };
    };
  };
};
var refEngine = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var pure19 = pure(dictMonadThrow.Monad0().Applicative0());
  return refEngineWith(dictMonadThrow)(function(v) {
    return function(name2) {
      return maybe(throwError3(new UnknownHelper(name2)))(pure19);
    };
  });
};
var isScopedBinding = function(name2) {
  return function(v) {
    var go = function(v1) {
      if (v1 instanceof Nil) {
        return false;
      }
      ;
      if (v1 instanceof Cons && v1.value1 instanceof Nil) {
        return false;
      }
      ;
      if (v1 instanceof Cons) {
        return member2(name2)(v1.value0) || go(v1.value1);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Env (line 201, column 3 - line 201, column 17): " + [v1.constructor.name]);
    };
    return go(v.helpers);
  };
};
var innermostFrame = function(v) {
  if (v.helpers instanceof Cons) {
    return v.helpers.value0;
  }
  ;
  if (v.helpers instanceof Nil) {
    return empty2;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Env (line 209, column 29 - line 211, column 19): " + [v.helpers.constructor.name]);
};
var enterPartial = function(v) {
  return {
    context: v.context,
    helpers: v.helpers,
    partials: v.partials,
    truthy: v.truthy,
    translator: v.translator,
    yieldName: v.yieldName,
    currentFile: v.currentFile,
    partialFiles: v.partialFiles,
    depth: v.depth + 1 | 0
  };
};
var emptyEnv = function(ctx2) {
  return {
    context: ctx2,
    helpers: new Cons(empty2, Nil.value),
    partials: empty2,
    truthy: handlebars,
    translator: Nothing.value,
    yieldName: "partial-block",
    depth: 0,
    currentFile: "main",
    partialFiles: empty2
  };
};
var constOperation = function(dictApplicative) {
  var pure19 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      return function(v2) {
        return pure19(v);
      };
    };
  };
};

// output/Data.Number.Format/foreign.js
function wrap(method) {
  return function(d) {
    return function(num) {
      return method.apply(num, [d]);
    };
  };
}
var toPrecisionNative = wrap(Number.prototype.toPrecision);
var toFixedNative = wrap(Number.prototype.toFixed);
var toExponentialNative = wrap(Number.prototype.toExponential);

// output/Data.Number.Format/index.js
var clamp2 = /* @__PURE__ */ clamp(ordInt);
var Precision = /* @__PURE__ */ (function() {
  function Precision2(value0) {
    this.value0 = value0;
  }
  ;
  Precision2.create = function(value0) {
    return new Precision2(value0);
  };
  return Precision2;
})();
var Fixed = /* @__PURE__ */ (function() {
  function Fixed2(value0) {
    this.value0 = value0;
  }
  ;
  Fixed2.create = function(value0) {
    return new Fixed2(value0);
  };
  return Fixed2;
})();
var Exponential = /* @__PURE__ */ (function() {
  function Exponential2(value0) {
    this.value0 = value0;
  }
  ;
  Exponential2.create = function(value0) {
    return new Exponential2(value0);
  };
  return Exponential2;
})();
var toStringWith = function(v) {
  if (v instanceof Precision) {
    return toPrecisionNative(v.value0);
  }
  ;
  if (v instanceof Fixed) {
    return toFixedNative(v.value0);
  }
  ;
  if (v instanceof Exponential) {
    return toExponentialNative(v.value0);
  }
  ;
  throw new Error("Failed pattern match at Data.Number.Format (line 59, column 1 - line 59, column 43): " + [v.constructor.name]);
};
var fixed = /* @__PURE__ */ (function() {
  var $9 = clamp2(0)(20);
  return function($10) {
    return Fixed.create($9($10));
  };
})();

// output/Kernel.Operation/index.js
var show5 = /* @__PURE__ */ show(showInt);
var wrongArity = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  return function(name2) {
    return function(arity) {
      return function(args) {
        return throwError3(new ArityError(name2 + (": expected " + (arityText2(arity) + (" argument(s), got " + show5(length(args)))))));
      };
    };
  };
};
var variadic = function(f) {
  return function(v) {
    return {
      arity: AnyArity.value,
      run: function(v1) {
        return function(args) {
          return f(args);
        };
      }
    };
  };
};
var unary = function(dictMonadThrow) {
  var wrongArity1 = wrongArity(dictMonadThrow);
  return function(f) {
    return function(name2) {
      return {
        arity: new Exactly(1),
        run: function(v) {
          return function(args) {
            if (args.length === 1) {
              return f(args[0]);
            }
            ;
            return wrongArity1(name2)(new Exactly(1))(args);
          };
        }
      };
    };
  };
};
var nullary = function(dictMonadThrow) {
  var wrongArity1 = wrongArity(dictMonadThrow);
  return function(v) {
    return function(name2) {
      return {
        arity: new Exactly(0),
        run: function(v1) {
          return function(args) {
            if (args.length === 0) {
              return v;
            }
            ;
            return wrongArity1(name2)(new Exactly(0))(args);
          };
        }
      };
    };
  };
};
var binary = function(dictMonadThrow) {
  var wrongArity1 = wrongArity(dictMonadThrow);
  return function(f) {
    return function(name2) {
      return {
        arity: new Exactly(2),
        run: function(v) {
          return function(args) {
            if (args.length === 2) {
              return f(args[0])(args[1]);
            }
            ;
            return wrongArity1(name2)(new Exactly(2))(args);
          };
        }
      };
    };
  };
};
var atLeast = function(dictMonadThrow) {
  var wrongArity1 = wrongArity(dictMonadThrow);
  return function(k) {
    return function(f) {
      return function(name2) {
        return {
          arity: new AtLeast(k),
          run: function(v) {
            return function(args) {
              var $24 = arityOk2(new AtLeast(k))(length(args));
              if ($24) {
                return f(args);
              }
              ;
              return wrongArity1(name2)(new AtLeast(k))(args);
            };
          }
        };
      };
    };
  };
};

// output/Kernel.Prelude/index.js
var show6 = /* @__PURE__ */ show(showInt);
var eq4 = /* @__PURE__ */ eq(eqValue);
var map15 = /* @__PURE__ */ map(functorArray);
var bind4 = /* @__PURE__ */ bind(bindMaybe);
var union4 = /* @__PURE__ */ union(ordString);
var map16 = /* @__PURE__ */ map(functorMap);
var lookup5 = /* @__PURE__ */ lookup2(ordString);
var notEq5 = /* @__PURE__ */ notEq(eqValue);
var append12 = /* @__PURE__ */ append(semigroupArray);
var pure3 = /* @__PURE__ */ pure(applicativeArray);
var sub2 = /* @__PURE__ */ sub(ringNumber);
var mul2 = /* @__PURE__ */ mul(semiringNumber);
var div4 = /* @__PURE__ */ div(euclideanRingNumber);
var traverse4 = /* @__PURE__ */ traverse(traversableArray);
var elem5 = /* @__PURE__ */ elem2(eqValue);
var alter2 = /* @__PURE__ */ alter(ordString);
var insert5 = /* @__PURE__ */ insert(ordString);
var compare2 = /* @__PURE__ */ compare(ordNumber);
var compare12 = /* @__PURE__ */ compare(ordString);
var apply3 = /* @__PURE__ */ apply(applyMaybe);
var map23 = /* @__PURE__ */ map(functorMaybe);
var eq23 = /* @__PURE__ */ eq(eqOrdering);
var notEq12 = /* @__PURE__ */ notEq(eqOrdering);
var show1 = /* @__PURE__ */ show(showString);
var max3 = /* @__PURE__ */ max(ordInt);
var min3 = /* @__PURE__ */ min(ordInt);
var discard2 = /* @__PURE__ */ discard(discardUnit);
var fromFoldable5 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var add1 = /* @__PURE__ */ add(semiringNumber);
var identity9 = /* @__PURE__ */ identity(categoryFn);
var toUnfoldable5 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var elem12 = /* @__PURE__ */ elem2(eqString);
var wrong1or2 = function(name2) {
  return function(args) {
    return name2 + (": expected 1 or 2 arguments, got " + show6(length(args)));
  };
};
var withSynonym = function(canonical) {
  return function(d) {
    return {
      name: d.name,
      doc: d.doc,
      block: d.block,
      arity: d.arity,
      run: d.run,
      alias: d.alias,
      synonymOf: new Just(canonical)
    };
  };
};
var withAlias = function(canonical) {
  return function(d) {
    return {
      name: d.name,
      doc: d.doc,
      block: d.block,
      arity: d.arity,
      run: d.run,
      synonymOf: d.synonymOf,
      alias: new Just(canonical)
    };
  };
};
var valDef = function(dictMonadThrow) {
  return function(name2) {
    return function(doc) {
      return function(mk) {
        var s = mk(name2);
        return {
          name: name2,
          doc,
          block: false,
          arity: s.arity,
          run: s.run,
          alias: Nothing.value,
          synonymOf: Nothing.value
        };
      };
    };
  };
};
var uniqueH = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(v) {
    if (v instanceof VArray) {
      return pure1(new VArray(nubByEq(eq4)(v.value0)));
    }
    ;
    return pure1(new VArray([]));
  };
};
var thisH = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(ctl) {
    return function(v) {
      return pure1(refContext(ctl.env));
    };
  };
};
var ternaryH = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 3) {
        return pure1((function() {
          var $731 = refTruthy(ctl.env)(args[0]);
          if ($731) {
            return args[1];
          }
          ;
          return args[2];
        })());
      }
      ;
      return throwError3(new ArityError("ternary: expected exactly 3 arguments"));
    };
  };
};
var stringifyM = function(dictMonadThrow) {
  var $1036 = liftEither(dictMonadThrow);
  return function($1037) {
    return $1036(stringify($1037));
  };
};
var toFloatH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(v) {
    return bind110(stringifyM1(v))(function(s) {
      return pure1(maybe(VNull.value)(VNumber.create)(fromString(s)));
    });
  };
};
var toIntH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(v) {
    return bind110(stringifyM1(v))(function(s) {
      return pure1(maybe(VNull.value)(function($1038) {
        return VNumber.create(trunc($1038));
      })(fromString(s)));
    });
  };
};
var strUnary = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(f) {
    return function(v) {
      return map37(function($1039) {
        return VString.create(f($1039));
      })(stringifyM1(v));
    };
  };
};
var startsWithH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      var isJustPrefix = function(p) {
        return function(str2) {
          var v = stripPrefix(p)(str2);
          if (v instanceof Just) {
            return true;
          }
          ;
          if (v instanceof Nothing) {
            return false;
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 898, column 24 - line 900, column 21): " + [v.constructor.name]);
        };
      };
      return bind110(stringifyM1(sv))(function(s) {
        return bind110(stringifyM1(xv))(function(x) {
          return pure1(new VBool(isJustPrefix(x)(s)));
        });
      });
    };
  };
};
var splitH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(sepv) {
      return bind110(stringifyM1(sv))(function(s) {
        return bind110(stringifyM1(sepv))(function(sep) {
          return pure1(new VArray(map15(VString.create)(split(sep)(s))));
        });
      });
    };
  };
};
var seamed = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(name2) {
    return function(fallback) {
      return function(ctl) {
        return function(args) {
          var v = bind4(refTranslator(ctl.env))(function(tr) {
            return tr(name2)(args);
          });
          if (v instanceof Just) {
            return pure1(new VString(v.value0));
          }
          ;
          if (v instanceof Nothing) {
            return fallback(ctl)(args);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 1322, column 33 - line 1324, column 31): " + [v.constructor.name]);
        };
      };
    };
  };
};
var scopedCanonical = /* @__PURE__ */ (function() {
  return [new Tuple("index", "index0"), new Tuple("parent-index", "loop.parent.index0"), new Tuple("parent-key", "loop.parent.key"), new Tuple("parent-first", "loop.parent.first"), new Tuple("parent-last", "loop.parent.last"), new Tuple("partial-block", "yield")];
})();
var safe2 = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    return map37(VSafe.create)(stringifyM1(v));
  };
};
var reverseCodeUnits = function($1040) {
  return fromCharArray(reverse(toCharArray($1040)));
};
var reverseH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure1 = pure(Monad0.Applicative0());
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    if (v instanceof VArray) {
      return pure1(new VArray(reverse(v.value0)));
    }
    ;
    if (v instanceof VString) {
      return pure1(new VString(reverseCodeUnits(v.value0)));
    }
    ;
    return map37(function($1041) {
      return VString.create(reverseCodeUnits($1041));
    })(stringifyM1(v));
  };
};
var replaceH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      if (args.length === 3) {
        return bind110(stringifyM1(args[0]))(function(s) {
          return bind110(stringifyM1(args[1]))(function(find3) {
            return bind110(stringifyM1(args[2]))(function(rep) {
              return pure1(new VString(replaceAll(find3)(rep)(s)));
            });
          });
        });
      }
      ;
      return throwError3(new ArityError("replace: expected exactly 3 argument(s), got " + show6(length(args))));
    };
  };
};
var renderSafe = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  return function(ctl) {
    return function(env) {
      return function(nodes) {
        return map37(VSafe.create)(ctl.render(env)(nodes));
      };
    };
  };
};
var rawH = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  return function(ctl) {
    return function(v) {
      return map37(VSafe.create)(ctl.render(ctl.env)(ctl.children));
    };
  };
};
var rangeBudget = 1e5;
var prependH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      return bind110(stringifyM1(sv))(function(s) {
        return bind110(stringifyM1(xv))(function(x) {
          return pure1(new VString(x + s));
        });
      });
    };
  };
};
var pickCase = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure1 = pure(Monad0.Applicative0());
  var bind110 = bind(Monad0.Bind1());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(subj) {
      return function(clauses) {
        var anyMatch = function(exprs) {
          var v2 = uncons(exprs);
          if (v2 instanceof Nothing) {
            return pure1(false);
          }
          ;
          if (v2 instanceof Just) {
            return bind110(ctl["eval"](ctl.env)(v2.value0.head))(function(v1) {
              var $747 = eq4(v1)(subj);
              if ($747) {
                return pure1(true);
              }
              ;
              return anyMatch(v2.value0.tail);
            });
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 1500, column 20 - line 1504, column 53): " + [v2.constructor.name]);
        };
        var v = uncons(clauses);
        if (v instanceof Nothing) {
          return pure1(new VSafe(""));
        }
        ;
        if (v instanceof Just) {
          if (v.value0.head.name === "else") {
            return renderSafe1(ctl)(ctl.env)(v.value0.head.body);
          }
          ;
          if (v.value0.head.name === "when") {
            return bind110(anyMatch(v.value0.head.args))(function(hit) {
              if (hit) {
                return renderSafe1(ctl)(ctl.env)(v.value0.head.body);
              }
              ;
              return pickCase(dictMonadThrow)(ctl)(subj)(v.value0.tail);
            });
          }
          ;
          return throwError3(new ClauseError("case: unexpected clause '" + (v.value0.head.name + "'")));
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1491, column 29 - line 1498, column 84): " + [v.constructor.name]);
      };
    };
  };
};
var partialH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure1 = pure(Monad0.Applicative0());
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var mergeHash = function(ctx2) {
        return function(opts) {
          if (opts instanceof VObject) {
            if (ctx2 instanceof VObject) {
              return new VObject(union4(opts.value0)(ctx2.value0));
            }
            ;
            return new VObject(opts.value0);
          }
          ;
          return ctx2;
        };
      };
      var hashFrame = function(opts) {
        if (opts instanceof VObject) {
          return map16(function(v) {
            return function(v1) {
              return function(v2) {
                return pure1(v);
              };
            };
          })(opts.value0);
        }
        ;
        return empty2;
      };
      var blockFrame = (function() {
        var $763 = $$null(ctl.children);
        if ($763) {
          return empty2;
        }
        ;
        var body = function(v) {
          return function(v1) {
            return map37(VSafe.create)(ctl.render(ctl.env)(ctl.children));
          };
        };
        return singleton4(refYieldName(ctl.env))(body);
      })();
      var renderPartial = function(name2) {
        return function(ctx2) {
          return function(frame) {
            var v = lookupPartial(name2)(ctl.env);
            if (v instanceof Just) {
              if (refDepth(ctl.env) >= recursionBudget) {
                return throwError3(new RecursionLimit(recursionBudget));
              }
              ;
              if (otherwise) {
                var entered = withPartialFileScope(name2)(enterPartial(pushFrame(union4(frame)(blockFrame))(ctx2)(ctl.env)));
                return map37(VSafe.create)(ctl.render(entered)(v.value0));
              }
              ;
            }
            ;
            if (v instanceof Nothing) {
              if ($$null(ctl.children)) {
                return throwError3(new HelperError("unknown partial '" + (name2 + "'")));
              }
              ;
              if (otherwise) {
                return map37(VSafe.create)(ctl.render(ctl.env)(ctl.children));
              }
              ;
            }
            ;
            throw new Error("Failed pattern match at Kernel.Prelude (line 1928, column 34 - line 1943, column 63): " + [v.constructor.name]);
          };
        };
      };
      if (args.length === 1 && args[0] instanceof VString) {
        return renderPartial(args[0].value0)(refContext(ctl.env))(empty2);
      }
      ;
      if (args.length === 2 && args[0] instanceof VString) {
        return renderPartial(args[0].value0)(args[1])(empty2);
      }
      ;
      if (args.length === 3 && args[0] instanceof VString) {
        return renderPartial(args[0].value0)(mergeHash(args[1])(args[2]))(hashFrame(args[2]));
      }
      ;
      return throwError3(new $$TypeError("partial: expected (name string, [context], [options])"));
    };
  };
};
var optFlag = function(key) {
  return function(v) {
    if (v instanceof VObject) {
      return maybe(false)(handlebars)(lookup5(key)(v.value0));
    }
    ;
    return false;
  };
};
var notH = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        return pure1(new VBool(!refTruthy(ctl.env)(args[0])));
      }
      ;
      return throwError3(new ArityError("not: expected exactly 1 argument"));
    };
  };
};
var ne$prime = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(a) {
    return function(b) {
      return pure1(new VBool(notEq5(a)(b)));
    };
  };
};
var mainBody = function(ctl) {
  return ctl.clause("else").before;
};
var renderMain = function(dictMonadThrow) {
  var renderSafe1 = renderSafe(dictMonadThrow);
  return function(ctl) {
    return renderSafe1(ctl)(ctl.env)(mainBody(ctl));
  };
};
var loopFieldCanonical = /* @__PURE__ */ (function() {
  return [new Tuple("index", "index0"), new Tuple("index0", "index0"), new Tuple("index1", "index1"), new Tuple("rindex", "rindex0"), new Tuple("rindex0", "rindex0"), new Tuple("rindex1", "rindex1"), new Tuple("first", "first"), new Tuple("last", "last"), new Tuple("key", "key"), new Tuple("length", "length"), new Tuple("size", "length"), new Tuple("depth", "depth")];
})();
var letH = function(dictMonadThrow) {
  var renderMain1 = renderMain(dictMonadThrow);
  var renderSafe1 = renderSafe(dictMonadThrow);
  var constOperation3 = constOperation(dictMonadThrow.Monad0().Applicative0());
  return function(ctl) {
    return function(args) {
      var addObj = function(acc) {
        return function(v) {
          if (v instanceof VObject) {
            return union4(v.value0)(acc);
          }
          ;
          return acc;
        };
      };
      var objs = append12(maybe([])(pure3)(ctl.hash))(args);
      var bindings = foldl2(addObj)(empty2)(objs);
      var $782 = isEmpty(bindings);
      if ($782) {
        return renderMain1(ctl);
      }
      ;
      return renderSafe1(ctl)(pushHelpers(map16(constOperation3)(bindings))(ctl.env))(mainBody(ctl));
    };
  };
};
var jsonText = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(name2) {
    return function(args) {
      if (args.length === 1) {
        return pure1(jsonStringify(args[0]));
      }
      ;
      if (args.length === 2) {
        return pure1((function() {
          var $785 = optFlag("pretty")(args[1]);
          if ($785) {
            return jsonStringifyPretty;
          }
          ;
          return jsonStringify;
        })()(args[0]));
      }
      ;
      return throwError3(new ArityError(wrong1or2(name2)(args)));
    };
  };
};
var jsonH = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var jsonText1 = jsonText(dictMonadThrow);
  return function(v) {
    return function(args) {
      return map37(VString.create)(jsonText1("json")(args));
    };
  };
};
var jsMod = function(a) {
  return function(b) {
    return a - b * trunc(a / b);
  };
};
var joinH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind110 = bind(Bind1);
  var stringifyM1 = stringifyM(dictMonadThrow);
  var Applicative0 = Monad0.Applicative0();
  var traverse16 = traverse4(Applicative0);
  var pure1 = pure(Applicative0);
  var map37 = map(Bind1.Apply0().Functor0());
  return function(av) {
    return function(sepv) {
      return bind110(stringifyM1(sepv))(function(sep) {
        if (av instanceof VArray) {
          return bind110(traverse16(stringifyM1)(av.value0))(function(parts) {
            return pure1(new VString(joinWith(sep)(parts)));
          });
        }
        ;
        return map37(VString.create)(stringifyM1(av));
      });
    };
  };
};
var isZeroNum = function(v) {
  if (v instanceof VNumber) {
    return v.value0 === 0;
  }
  ;
  return false;
};
var truthyWith = function(tf) {
  return function(opts) {
    return function(v) {
      var v1 = function(v2) {
        if (otherwise) {
          return tf(v);
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1536, column 1 - line 1536, column 62): " + [tf.constructor.name, opts.constructor.name, v.constructor.name]);
      };
      var $798 = optFlag("includeZero")(opts);
      if ($798) {
        var $799 = isZeroNum(v);
        if ($799) {
          return true;
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
};
var pickClause = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure1 = pure(Monad0.Applicative0());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var Bind1 = Monad0.Bind1();
  var bind110 = bind(Bind1);
  var map37 = map(Bind1.Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(clauses) {
      var v = uncons(clauses);
      if (v instanceof Nothing) {
        return pure1(new VSafe(""));
      }
      ;
      if (v instanceof Just) {
        if (v.value0.head.name === "else") {
          return renderSafe1(ctl)(ctl.env)(v.value0.head.body);
        }
        ;
        if (v.value0.head.name === "elif") {
          var elifBranch = function(condE) {
            return function(mOpts) {
              return bind110(ctl["eval"](ctl.env)(condE))(function(cond) {
                return bind110((function() {
                  if (mOpts instanceof Nothing) {
                    return pure1(refTruthy(ctl.env)(cond));
                  }
                  ;
                  if (mOpts instanceof Just) {
                    return map37(function(opts) {
                      return truthyWith(refTruthy(ctl.env))(opts)(cond);
                    })(ctl["eval"](ctl.env)(mOpts.value0));
                  }
                  ;
                  throw new Error("Failed pattern match at Kernel.Prelude (line 1444, column 16 - line 1447, column 18): " + [mOpts.constructor.name]);
                })())(function(hit) {
                  if (hit) {
                    return renderSafe1(ctl)(ctl.env)(v.value0.head.body);
                  }
                  ;
                  return pickClause(dictMonadThrow)(ctl)(v.value0.tail);
                });
              });
            };
          };
          if (v.value0.head.args.length === 1) {
            return elifBranch(v["value0"]["head"]["args"][0])(Nothing.value);
          }
          ;
          if (v.value0.head.args.length === 2) {
            return elifBranch(v["value0"]["head"]["args"][0])(new Just(v["value0"]["head"]["args"][1]));
          }
          ;
          return throwError3(new ClauseError("elif: expected 1 or 2 arguments"));
        }
        ;
        return throwError3(new ClauseError("if: unexpected clause '" + (v.value0.head.name + "'")));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1430, column 26 - line 1449, column 82): " + [v.constructor.name]);
    };
  };
};
var inlineH = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      return pure1(new VSafe(""));
    };
  };
};
var indexValue = function(v) {
  return function(v1) {
    if (v instanceof VObject && v1 instanceof VString) {
      return fromMaybe(VNull.value)(lookup5(v1.value0)(v.value0));
    }
    ;
    if (v instanceof VObject && v1 instanceof VNumber) {
      return fromMaybe(VNull.value)(lookup5(show6(round2(v1.value0)))(v.value0));
    }
    ;
    if (v instanceof VArray && v1 instanceof VNumber) {
      return fromMaybe(VNull.value)(index(v.value0)(round2(v1.value0)));
    }
    ;
    if (v instanceof VArray && v1 instanceof VString) {
      var v2 = fromString2(v1.value0);
      if (v2 instanceof Just) {
        return fromMaybe(VNull.value)(index(v.value0)(v2.value0));
      }
      ;
      if (v2 instanceof Nothing) {
        return VNull.value;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1365, column 38 - line 1367, column 19): " + [v2.constructor.name]);
    }
    ;
    return VNull.value;
  };
};
var lookupH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(v) {
    return function(args) {
      var step2 = function(v12) {
        return function(v2) {
          if (v12 instanceof VNull) {
            return VNull.value;
          }
          ;
          return indexValue(v12)(v2);
        };
      };
      var v1 = uncons(args);
      if (v1 instanceof Nothing) {
        return throwError3(new ArityError("lookup: expected at least 1 argument(s), got 0"));
      }
      ;
      if (v1 instanceof Just) {
        return pure1(foldl2(step2)(v1.value0.head)(v1.value0.tail));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1287, column 18 - line 1289, column 59): " + [v1.constructor.name]);
    };
  };
};
var includesH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure1 = pure(Monad0.Applicative0());
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(sv) {
    return function(xv) {
      if (sv instanceof VArray) {
        return pure1(new VBool(elem5(xv)(sv.value0)));
      }
      ;
      if (sv instanceof VString) {
        return bind110(stringifyM1(xv))(function(sub22) {
          return pure1(new VBool(contains(sub22)(sv.value0)));
        });
      }
      ;
      return pure1(new VBool(false));
    };
  };
};
var i18nOp = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var liftEither2 = liftEither(dictMonadThrow);
  var seamed1 = seamed(dictMonadThrow);
  return function(name2) {
    var passthrough = function(v) {
      return function(args) {
        var v1 = head(args);
        if (v1 instanceof Nothing) {
          return throwError3(new ArityError(name2 + ": expected at least 1 argument(s), got 0"));
        }
        ;
        if (v1 instanceof Just) {
          return map37(VString.create)(liftEither2(stringify(v1.value0)));
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1331, column 24 - line 1333, column 51): " + [v1.constructor.name]);
      };
    };
    return seamed1(name2)(passthrough);
  };
};
var numberH = function(dictMonadThrow) {
  return i18nOp(dictMonadThrow)("number");
};
var translateH = function(dictMonadThrow) {
  return i18nOp(dictMonadThrow)("t");
};
var gen = function(name2) {
  return function(doc) {
    return function(block2) {
      return function(arity) {
        return function(run3) {
          return {
            name: name2,
            doc,
            block: block2,
            arity,
            run: run3,
            alias: Nothing.value,
            synonymOf: Nothing.value
          };
        };
      };
    };
  };
};
var firstTruthyH = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(ctl) {
    return function(args) {
      return pure1(fromMaybe(VNull.value)(find2(refTruthy(ctl.env))(args)));
    };
  };
};
var filterElems = function(v) {
  if (v instanceof VArray) {
    return v.value0;
  }
  ;
  return [];
};
var extractPath = function(path2) {
  return function(v) {
    return foldl2(function(acc) {
      return function(seg) {
        return indexValue(acc)(new VString(seg));
      };
    })(v)(split(".")(path2));
  };
};
var groupByH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var foldM2 = foldM(Monad0);
  return function(av) {
    return function(keyv) {
      var insertGroup = function(key) {
        return function(acc) {
          return function(el) {
            return bind110(stringifyM1(extractPath(key)(el)))(function(k) {
              return pure1(alter2(function(mv) {
                return new Just(cons(el)(fromMaybe([])(mv)));
              })(k)(acc));
            });
          };
        };
      };
      return bind110(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return bind110(foldM2(insertGroup(key))(empty2)(av.value0))(function(grouped) {
            return pure1(new VObject(map16(function($1042) {
              return VArray.create(reverse($1042));
            })(grouped)));
          });
        }
        ;
        return pure1(new VObject(empty2));
      });
    };
  };
};
var pluckH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(av) {
    return function(keyv) {
      return bind110(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return pure1(new VArray(map15(extractPath(key))(av.value0)));
        }
        ;
        return pure1(new VArray([]));
      });
    };
  };
};
var escJsonH = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var jsonText1 = jsonText(dictMonadThrow);
  return function(v) {
    return function(args) {
      return map37(function($1043) {
        return VSafe.create(escapeHtml($1043));
      })(jsonText1("escapeJson")(args));
    };
  };
};
var escHtml = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure1 = pure(Monad0.Applicative0());
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    if (v instanceof VSafe) {
      return pure1(new VSafe(v.value0));
    }
    ;
    return map37(function($1044) {
      return VSafe.create(escapeHtml($1044));
    })(stringifyM1(v));
  };
};
var eq$prime = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(a) {
    return function(b) {
      return pure1(new VBool(eq4(a)(b)));
    };
  };
};
var endsWithH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      var isJustSuffix = function(sfx) {
        return function(str2) {
          var v = stripSuffix(sfx)(str2);
          if (v instanceof Just) {
            return true;
          }
          ;
          if (v instanceof Nothing) {
            return false;
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 908, column 26 - line 910, column 21): " + [v.constructor.name]);
        };
      };
      return bind110(stringifyM1(sv))(function(s) {
        return bind110(stringifyM1(xv))(function(x) {
          return pure1(new VBool(isJustSuffix(x)(s)));
        });
      });
    };
  };
};
var elseBody = function(ctl) {
  return fromMaybe([])(ctl.clause("else").body);
};
var renderElse = function(dictMonadThrow) {
  var renderSafe1 = renderSafe(dictMonadThrow);
  return function(ctl) {
    return renderSafe1(ctl)(ctl.env)(elseBody(ctl));
  };
};
var dictH = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var build = function($copy_as) {
        return function($copy_acc) {
          var $tco_var_as = $copy_as;
          var $tco_done = false;
          var $tco_result;
          function $tco_loop(as, acc) {
            var v1 = uncons(as);
            if (v1 instanceof Nothing) {
              $tco_done = true;
              return pure1(new VObject(acc));
            }
            ;
            if (v1 instanceof Just && v1.value0.head instanceof VString) {
              var v2 = uncons(v1.value0.tail);
              if (v2 instanceof Just) {
                $tco_var_as = v2.value0.tail;
                $copy_acc = insert5(v1.value0.head.value0)(v2.value0.head)(acc);
                return;
              }
              ;
              if (v2 instanceof Nothing) {
                $tco_done = true;
                return throwError3(new ArityError("dict: odd number of arguments"));
              }
              ;
              throw new Error("Failed pattern match at Kernel.Prelude (line 1870, column 39 - line 1872, column 73): " + [v2.constructor.name]);
            }
            ;
            if (v1 instanceof Just) {
              $tco_done = true;
              return throwError3(new $$TypeError("dict: keys must be strings"));
            }
            ;
            throw new Error("Failed pattern match at Kernel.Prelude (line 1868, column 18 - line 1873, column 66): " + [v1.constructor.name]);
          }
          ;
          while (!$tco_done) {
            $tco_result = $tco_loop($tco_var_as, $copy_acc);
          }
          ;
          return $tco_result;
        };
      };
      return build(args)(empty2);
    };
  };
};
var dateH = function(dictMonadThrow) {
  return i18nOp(dictMonadThrow)("date");
};
var countH = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(v) {
    if (v instanceof VArray) {
      return pure1(new VNumber(toNumber(length(v.value0))));
    }
    ;
    if (v instanceof VObject) {
      return pure1(new VNumber(toNumber(size(v.value0))));
    }
    ;
    return pure1(new VNumber(0));
  };
};
var compareValues = function(a) {
  return function(b) {
    if (a instanceof VNumber && b instanceof VNumber) {
      return new Just(compare2(a.value0)(b.value0));
    }
    ;
    if (a instanceof VString && b instanceof VString) {
      return new Just(compare12(a.value0)(b.value0));
    }
    ;
    return Nothing.value;
  };
};
var sortByH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(av) {
    return function(keyv) {
      var keyOrdering = function(key) {
        return function(a) {
          return function(b) {
            return fromMaybe(EQ.value)(compareValues(extractPath(key)(a))(extractPath(key)(b)));
          };
        };
      };
      return bind110(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return pure1(new VArray(sortBy(function(a) {
            return function(b) {
              return keyOrdering(key)(a)(b);
            };
          })(av.value0)));
        }
        ;
        return pure1(new VArray([]));
      });
    };
  };
};
var comparatorByName = /* @__PURE__ */ (function() {
  var strOf = function(v) {
    return either($$const(Nothing.value))(Just.create)(stringify(v));
  };
  var strPred = function(test) {
    return function(a) {
      return function(b) {
        return fromMaybe(false)(apply3(map23(test)(strOf(a)))(strOf(b)));
      };
    };
  };
  var orderPred = function(ok) {
    return function(a) {
      return function(b) {
        return maybe(false)(ok)(compareValues(a)(b));
      };
    };
  };
  var includesPred = function(a) {
    return function(b) {
      if (a instanceof VArray) {
        return elem5(b)(a.value0);
      }
      ;
      if (a instanceof VString) {
        return maybe(false)(function(x) {
          return contains(x)(a.value0);
        })(strOf(b));
      }
      ;
      return false;
    };
  };
  var hasAffix = function(strip) {
    return function(affix) {
      return function(str2) {
        return maybe(false)($$const(true))(strip(affix)(str2));
      };
    };
  };
  return function(v) {
    if (v === "eq") {
      return new Just(eq4);
    }
    ;
    if (v === "==") {
      return new Just(eq4);
    }
    ;
    if (v === "ne") {
      return new Just(notEq5);
    }
    ;
    if (v === "!=") {
      return new Just(notEq5);
    }
    ;
    if (v === "lt") {
      return new Just(orderPred(function(v1) {
        return eq23(v1)(LT.value);
      }));
    }
    ;
    if (v === "<") {
      return new Just(orderPred(function(v1) {
        return eq23(v1)(LT.value);
      }));
    }
    ;
    if (v === "gt") {
      return new Just(orderPred(function(v1) {
        return eq23(v1)(GT.value);
      }));
    }
    ;
    if (v === ">") {
      return new Just(orderPred(function(v1) {
        return eq23(v1)(GT.value);
      }));
    }
    ;
    if (v === "lte") {
      return new Just(orderPred(function(v1) {
        return notEq12(v1)(GT.value);
      }));
    }
    ;
    if (v === "<=") {
      return new Just(orderPred(function(v1) {
        return notEq12(v1)(GT.value);
      }));
    }
    ;
    if (v === "gte") {
      return new Just(orderPred(function(v1) {
        return notEq12(v1)(LT.value);
      }));
    }
    ;
    if (v === ">=") {
      return new Just(orderPred(function(v1) {
        return notEq12(v1)(LT.value);
      }));
    }
    ;
    if (v === "startsWith") {
      return new Just(strPred(function(field) {
        return function(x) {
          return hasAffix(stripPrefix)(x)(field);
        };
      }));
    }
    ;
    if (v === "endsWith") {
      return new Just(strPred(function(field) {
        return function(x) {
          return hasAffix(stripSuffix)(x)(field);
        };
      }));
    }
    ;
    if (v === "includes") {
      return new Just(includesPred);
    }
    ;
    return Nothing.value;
  };
})();
var runFilter = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(truthyF) {
    return function(name2) {
      return function(args) {
        return function(combine) {
          var withKey = function(coll) {
            return function(keyv) {
              return function(mk) {
                return bind110(stringifyM1(keyv))(function(key) {
                  return pure1(combine(mk(key))(filterElems(coll)));
                });
              };
            };
          };
          if (args.length === 2) {
            return withKey(args[0])(args[1])(function(key) {
              return function(item) {
                return truthyF(extractPath(key)(item));
              };
            });
          }
          ;
          if (args.length === 3) {
            return withKey(args[0])(args[1])(function(key) {
              return function(item) {
                return eq4(extractPath(key)(item))(args[2]);
              };
            });
          }
          ;
          if (args.length === 4) {
            return bind110(stringifyM1(args[2]))(function(cmpName) {
              var v = comparatorByName(cmpName);
              if (v instanceof Just) {
                return withKey(args[0])(args[1])(function(key) {
                  return function(item) {
                    return v.value0(extractPath(key)(item))(args[3]);
                  };
                });
              }
              ;
              if (v instanceof Nothing) {
                return throwError3(new HelperError(name2 + (": unknown comparator " + (show1(cmpName) + "; expected one of eq/==, ne/!=, lt/<, lte/<=, gt/>, gte/>=, startsWith, endsWith, includes"))));
              }
              ;
              throw new Error("Failed pattern match at Kernel.Prelude (line 1243, column 5 - line 1251, column 10): " + [v.constructor.name]);
            });
          }
          ;
          return throwError3(new ArityError(name2 + (": expected 2 to 4 arguments, got " + show6(length(args)))));
        };
      };
    };
  };
};
var everyH = function(dictMonadThrow) {
  var runFilter1 = runFilter(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return runFilter1(refTruthy(ctl.env))("every")(args)(function(keep) {
        return function(xs) {
          return new VBool(all2(keep)(xs));
        };
      });
    };
  };
};
var findH = function(dictMonadThrow) {
  var runFilter1 = runFilter(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return runFilter1(refTruthy(ctl.env))("find")(args)(function(keep) {
        return function(xs) {
          return fromMaybe(VNull.value)(find2(keep)(xs));
        };
      });
    };
  };
};
var rejectH = function(dictMonadThrow) {
  var runFilter1 = runFilter(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return runFilter1(refTruthy(ctl.env))("reject")(args)(function(keep) {
        return function(xs) {
          return new VArray(filter(function($1045) {
            return !keep($1045);
          })(xs));
        };
      });
    };
  };
};
var someH = function(dictMonadThrow) {
  var runFilter1 = runFilter(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return runFilter1(refTruthy(ctl.env))("some")(args)(function(keep) {
        return function(xs) {
          return new VBool(any2(keep)(xs));
        };
      });
    };
  };
};
var whereH = function(dictMonadThrow) {
  var runFilter1 = runFilter(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return runFilter1(refTruthy(ctl.env))("where")(args)(function(keep) {
        return function(xs) {
          return new VArray(filter(keep)(xs));
        };
      });
    };
  };
};
var coalesceH = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(v) {
    return function(args) {
      var notNull = function(v1) {
        if (v1 instanceof VNull) {
          return false;
        }
        ;
        return true;
      };
      return pure1(fromMaybe(VNull.value)(find2(notNull)(args)));
    };
  };
};
var cmp = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(ok) {
    return function(a) {
      return function(b) {
        return pure1(new VBool(maybe(false)(ok)(compareValues(a)(b))));
      };
    };
  };
};
var clampIndex = function(len) {
  return function(i) {
    if (i < 0) {
      return max3(len + i | 0)(0);
    }
    ;
    if (otherwise) {
      return min3(i)(len);
    }
    ;
    throw new Error("Failed pattern match at Kernel.Prelude (line 872, column 1 - line 872, column 32): " + [len.constructor.name, i.constructor.name]);
  };
};
var checkIfClauses = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(clauses) {
    var v = uncons(clauses);
    if (v instanceof Nothing) {
      return pure1(unit);
    }
    ;
    if (v instanceof Just) {
      if (v.value0.head.name === "else") {
        if ($$null(v.value0.tail)) {
          return pure1(unit);
        }
        ;
        if (otherwise) {
          return throwError3(new ClauseError("if: {{else}} must be the final clause"));
        }
        ;
      }
      ;
      if (v.value0.head.name === "elif") {
        if (v.value0.head.args.length === 1) {
          return checkIfClauses(dictMonadThrow)(v.value0.tail);
        }
        ;
        if (v.value0.head.args.length === 2) {
          return checkIfClauses(dictMonadThrow)(v.value0.tail);
        }
        ;
        return throwError3(new ClauseError("elif: expected 1 or 2 arguments"));
      }
      ;
      return throwError3(new ClauseError("if: unexpected clause '" + (v.value0.head.name + "'")));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Prelude (line 1456, column 26 - line 1466, column 82): " + [v.constructor.name]);
  };
};
var ifH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind110 = bind(Bind1);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  var discard1 = discard2(Bind1);
  var checkIfClauses1 = checkIfClauses(dictMonadThrow);
  var renderSafe1 = renderSafe(dictMonadThrow);
  var pickClause1 = pickClause(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return bind110((function() {
        if (args.length === 1) {
          return pure1(refTruthy(ctl.env)(args[0]));
        }
        ;
        if (args.length === 2) {
          return pure1(truthyWith(refTruthy(ctl.env))(args[1])(args[0]));
        }
        ;
        return throwError3(new ArityError(wrong1or2("if")(args)));
      })())(function(cond) {
        var v = splitClauses(ctl.children);
        return discard1(checkIfClauses1(v.clauses))(function() {
          if (cond) {
            return renderSafe1(ctl)(ctl.env)(v.before);
          }
          ;
          return pickClause1(ctl)(v.clauses);
        });
      });
    };
  };
};
var checkCaseClauses = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(clauses) {
    var v = uncons(clauses);
    if (v instanceof Nothing) {
      return pure1(unit);
    }
    ;
    if (v instanceof Just) {
      if (v.value0.head.name === "when") {
        return checkCaseClauses(dictMonadThrow)(v.value0.tail);
      }
      ;
      if (v.value0.head.name === "else") {
        if ($$null(v.value0.tail)) {
          return pure1(unit);
        }
        ;
        if (otherwise) {
          return throwError3(new ClauseError("case: {{else}} must be the final clause"));
        }
        ;
      }
      ;
      return throwError3(new ClauseError("case: unexpected clause '" + (v.value0.head.name + "'")));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Prelude (line 1509, column 28 - line 1516, column 84): " + [v.constructor.name]);
  };
};
var caseH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind110 = bind(Bind1);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  var discard1 = discard2(Bind1);
  var checkCaseClauses1 = checkCaseClauses(dictMonadThrow);
  var pickCase1 = pickCase(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return bind110((function() {
        if (args.length === 1) {
          return pure1(args[0]);
        }
        ;
        return throwError3(new ArityError("case expects exactly 1 argument (the subject)"));
      })())(function(subj) {
        var v = splitClauses(ctl.children);
        return discard1(checkCaseClauses1(v.clauses))(function() {
          return pickCase1(ctl)(subj)(v.clauses);
        });
      });
    };
  };
};
var capitalizeStr = function(s) {
  var v = uncons2(s);
  if (v instanceof Nothing) {
    return s;
  }
  ;
  if (v instanceof Just) {
    return toUpper(singleton5(v.value0.head)) + v.value0.tail;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Prelude (line 798, column 19 - line 800, column 68): " + [v.constructor.name]);
};
var buildContextChain = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var pure1 = pure(Monad0.Applicative0());
  return function(ctl) {
    return bind110((function() {
      var v = lookupOperation("@parentchain")(ctl.env);
      if (v instanceof Just) {
        return v.value0(ctl)([]);
      }
      ;
      if (v instanceof Nothing) {
        return pure1(VNull.value);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1599, column 21 - line 1601, column 26): " + [v.constructor.name]);
    })())(function(enclosingChain) {
      var enclosingCtx = refContext(ctl.env);
      var rootCtx = (function() {
        if (enclosingChain instanceof VObject) {
          return fromMaybe(enclosingCtx)(lookup5("root")(enclosingChain.value0));
        }
        ;
        return enclosingCtx;
      })();
      var ctxFields = (function() {
        if (enclosingCtx instanceof VObject) {
          return enclosingCtx.value0;
        }
        ;
        return empty2;
      })();
      return pure1(new VObject(union4(fromFoldable5([new Tuple("this", enclosingCtx), new Tuple("parent", enclosingChain), new Tuple("root", rootCtx)]))(ctxFields)));
    });
  };
};
var iterate2 = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind110 = bind(Bind1);
  var Applicative0 = Monad0.Applicative0();
  var pure1 = pure(Applicative0);
  var buildContextChain1 = buildContextChain(dictMonadThrow);
  var constOperation3 = constOperation(Applicative0);
  var map37 = map(Bind1.Apply0().Functor0());
  var traverse16 = traverse4(Applicative0);
  return function(ctl) {
    return function(names) {
      return function(items) {
        return bind110((function() {
          var v = lookupOperation("loop")(ctl.env);
          if (v instanceof Just) {
            return v.value0(ctl)([]);
          }
          ;
          if (v instanceof Nothing) {
            return pure1(VNull.value);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 1632, column 20 - line 1634, column 26): " + [v.constructor.name]);
        })())(function(enclosingLoop) {
          return bind110(buildContextChain1(ctl))(function(parentChain) {
            var thisDepth = (function() {
              if (enclosingLoop instanceof VObject) {
                var v = lookup5("depth")(enclosingLoop.value0);
                if (v instanceof Just && v.value0 instanceof VNumber) {
                  return v.value0.value0 + 1;
                }
                ;
                return 1;
              }
              ;
              return 1;
            })();
            var n = length(items);
            var metaFields = function(i) {
              return function(val) {
                return function(key) {
                  return [new Tuple("this", val), new Tuple("index0", new VNumber(toNumber(i))), new Tuple("index1", new VNumber(toNumber(i + 1 | 0))), new Tuple("rindex0", new VNumber(toNumber((n - 1 | 0) - i | 0))), new Tuple("rindex1", new VNumber(toNumber(n - i | 0))), new Tuple("first", new VBool(i === 0)), new Tuple("last", new VBool(i === (n - 1 | 0))), new Tuple("length", new VNumber(toNumber(n))), new Tuple("key", key), new Tuple("depth", new VNumber(thisDepth))];
                };
              };
            };
            var rootLoop = function(i) {
              return function(val) {
                return function(key) {
                  if (enclosingLoop instanceof VObject) {
                    return fromMaybe(new VObject(fromFoldable5(metaFields(i)(val)(key))))(lookup5("root")(enclosingLoop.value0));
                  }
                  ;
                  return new VObject(fromFoldable5(metaFields(i)(val)(key)));
                };
              };
            };
            var main = mainBody(ctl);
            var loopObject = function(i) {
              return function(val) {
                return function(key) {
                  return new VObject(fromFoldable5(append12(metaFields(i)(val)(key))([new Tuple("parent", enclosingLoop), new Tuple("root", rootLoop(i)(val)(key))])));
                };
              };
            };
            var loopBinds = function(i) {
              return function(val) {
                return function(key) {
                  return append12([new Tuple("loop", constOperation3(loopObject(i)(val)(key))), new Tuple("@parentchain", constOperation3(parentChain))])((function() {
                    if (ctl.loopLabel instanceof Just) {
                      return [new Tuple(ctl.loopLabel.value0, constOperation3(loopObject(i)(val)(key)))];
                    }
                    ;
                    if (ctl.loopLabel instanceof Nothing) {
                      return [];
                    }
                    ;
                    throw new Error("Failed pattern match at Kernel.Prelude (line 1690, column 12 - line 1692, column 24): " + [ctl.loopLabel.constructor.name]);
                  })());
                };
              };
            };
            var binds = function(i) {
              return function(val) {
                return function(idx) {
                  return zipWith(function(nm) {
                    return function(v) {
                      return new Tuple(nm, constOperation3(v));
                    };
                  })(names)([val, idx, new VNumber(toNumber(i + 1 | 0))]);
                };
              };
            };
            var renderItem = function(i) {
              return function(v) {
                var frame = fromFoldable5(append12([new Tuple("this", constOperation3(v.val)), new Tuple("index", constOperation3(new VNumber(toNumber(i)))), new Tuple("key", constOperation3(v.key)), new Tuple("first", constOperation3(new VBool(i === 0))), new Tuple("last", constOperation3(new VBool(i === (n - 1 | 0)))), new Tuple("parent", constOperation3(refContext(ctl.env))), new Tuple("index0", constOperation3(new VNumber(toNumber(i)))), new Tuple("index1", constOperation3(new VNumber(toNumber(i + 1 | 0)))), new Tuple("rindex0", constOperation3(new VNumber(toNumber((n - 1 | 0) - i | 0)))), new Tuple("rindex1", constOperation3(new VNumber(toNumber(n - i | 0)))), new Tuple("length", constOperation3(new VNumber(toNumber(n)))), new Tuple("depth", constOperation3(new VNumber(thisDepth)))])(append12(binds(i)(v.val)(v.idx))(loopBinds(i)(v.val)(v.key))));
                return ctl.render(pushFrame(frame)(v.val)(ctl.env))(main);
              };
            };
            return map37((function() {
              var $1046 = joinWith("");
              return function($1047) {
                return VSafe.create($1046($1047));
              };
            })())(traverse16(identity9)(mapWithIndex2(renderItem)(items)));
          });
        });
      };
    };
  };
};
var branchOn = function(dictMonadThrow) {
  var renderMain1 = renderMain(dictMonadThrow);
  var renderElse1 = renderElse(dictMonadThrow);
  return function(cond) {
    return function(ctl) {
      if (cond) {
        return renderMain1(ctl);
      }
      ;
      return renderElse1(ctl);
    };
  };
};
var unlessH = function(dictMonadThrow) {
  var branchOn1 = branchOn(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        return branchOn1(!refTruthy(ctl.env)(args[0]))(ctl);
      }
      ;
      if (args.length === 2) {
        return branchOn1(!truthyWith(refTruthy(ctl.env))(args[1])(args[0]))(ctl);
      }
      ;
      return throwError3(new ArityError(wrong1or2("unless")(args)));
    };
  };
};
var boolH = function(dictApplicative) {
  var pure1 = pure(dictApplicative);
  return function(quant) {
    return function(ctl) {
      return function(args) {
        return pure1(new VBool(quant(refTruthy(ctl.env))(args)));
      };
    };
  };
};
var bodyStart = function(s) {
  var body = trim(s);
  var $942 = body === "";
  if ($942) {
    return Nothing.value;
  }
  ;
  return indexOf(body)(s);
};
var trimEndStr = function(s) {
  var v = bodyStart(s);
  if (v instanceof Nothing) {
    return "";
  }
  ;
  if (v instanceof Just) {
    return take2(v.value0 + length2(trim(s)) | 0)(s);
  }
  ;
  throw new Error("Failed pattern match at Kernel.Prelude (line 814, column 16 - line 816, column 68): " + [v.constructor.name]);
};
var trimStartStr = function(s) {
  var v = bodyStart(s);
  if (v instanceof Nothing) {
    return "";
  }
  ;
  if (v instanceof Just) {
    return drop2(v.value0)(s);
  }
  ;
  throw new Error("Failed pattern match at Kernel.Prelude (line 809, column 18 - line 811, column 31): " + [v.constructor.name]);
};
var bindingNames = /* @__PURE__ */ mapMaybe(function(v) {
  if (v instanceof VString) {
    return new Just(v.value0);
  }
  ;
  return Nothing.value;
});
var eachH = function(dictMonadThrow) {
  var renderElse1 = renderElse(dictMonadThrow);
  var iterate1 = iterate2(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just) {
        var names = bindingNames(v.value0.tail);
        if (v.value0.head instanceof VArray) {
          var $951 = $$null(v.value0.head.value0);
          if ($951) {
            return renderElse1(ctl);
          }
          ;
          return iterate1(ctl)(names)(mapWithIndex2(function(i) {
            return function(x) {
              return {
                val: x,
                key: VNull.value,
                idx: new VNumber(toNumber(i))
              };
            };
          })(v.value0.head.value0));
        }
        ;
        if (v.value0.head instanceof VObject) {
          var pairs = toUnfoldable5(v.value0.head.value0);
          var $953 = $$null(pairs);
          if ($953) {
            return renderElse1(ctl);
          }
          ;
          return iterate1(ctl)(names)(map15(function(v1) {
            return {
              val: v1.value1,
              key: new VString(v1.value0),
              idx: new VString(v1.value0)
            };
          })(pairs));
        }
        ;
        return renderElse1(ctl);
      }
      ;
      if (v instanceof Nothing) {
        return throwError3(new ArityError("each: expected at least 1 argument(s), got 0"));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1562, column 18 - line 1583, column 84): " + [v.constructor.name]);
    };
  };
};
var withH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var buildContextChain1 = buildContextChain(dictMonadThrow);
  var constOperation3 = constOperation(Monad0.Applicative0());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var renderElse1 = renderElse(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just) {
        var $962 = refTruthy(ctl.env)(v.value0.head);
        if ($962) {
          return bind110(buildContextChain1(ctl))(function(parentChain) {
            var binds = zipWith(function(nm) {
              return function(val) {
                return new Tuple(nm, constOperation3(val));
              };
            })(bindingNames(v.value0.tail))([v.value0.head]);
            var frame = fromFoldable5(append12([new Tuple("parent", constOperation3(refContext(ctl.env))), new Tuple("@parentchain", constOperation3(parentChain))])(binds));
            return renderSafe1(ctl)(pushFrame(frame)(v.value0.head)(ctl.env))(mainBody(ctl));
          });
        }
        ;
        return renderElse1(ctl);
      }
      ;
      if (v instanceof Nothing) {
        return throwError3(new ArityError("with: expected at least 1 argument(s), got 0"));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1725, column 18 - line 1741, column 84): " + [v.constructor.name]);
    };
  };
};
var sectionOp = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var eachH1 = eachH(dictMonadThrow);
  var withH1 = withH(dictMonadThrow);
  return function(name2) {
    return function(ctl) {
      return function(args) {
        if ($$null(ctl.children) && !$$null(args)) {
          return throwError3(new UnknownHelper(name2));
        }
        ;
        if (otherwise) {
          var v = indexValue(refContext(ctl.env))(new VString(name2));
          if (v instanceof VArray) {
            return eachH1(ctl)([v]);
          }
          ;
          return withH1(ctl)([v]);
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1829, column 1 - line 1829, column 77): " + [name2.constructor.name, ctl.constructor.name, args.constructor.name]);
      };
    };
  };
};
var valueOrSection = function(dictMonadThrow) {
  var sectionOp1 = sectionOp(dictMonadThrow);
  return function(name2) {
    return function(h) {
      return function(ctl) {
        return function(args) {
          if ($$null(args)) {
            return sectionOp1(name2)(ctl)(args);
          }
          ;
          if (otherwise) {
            return h(ctl)(args);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 1819, column 1 - line 1824, column 28): " + [name2.constructor.name, h.constructor.name, ctl.constructor.name, args.constructor.name]);
        };
      };
    };
  };
};
var bindH = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(name2) {
    return function(value) {
      if (name2 instanceof VString) {
        return pure1(new VObject(singleton4(name2.value0)(value)));
      }
      ;
      return throwError3(new $$TypeError("bind: the binding name must be a string"));
    };
  };
};
var asStr = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    if (v instanceof VString) {
      return pure1(v.value0);
    }
    ;
    if (v instanceof VSafe) {
      return pure1(v.value0);
    }
    ;
    return throwError3(new $$TypeError("concat expects two strings"));
  };
};
var concatH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asStr1 = asStr(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(a) {
    return function(b) {
      return bind110(asStr1(a))(function(x) {
        return bind110(asStr1(b))(function(y) {
          return pure1(new VString(x + y));
        });
      });
    };
  };
};
var asNum = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    if (v instanceof VNumber) {
      return pure1(v.value0);
    }
    ;
    return throwError3(new $$TypeError("arithmetic expects a number"));
  };
};
var divisibleByH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(a) {
    return function(b) {
      return bind110(asNum1(a))(function(n) {
        return bind110(asNum1(b))(function(d) {
          return pure1(new VBool(jsMod(n)(d) === 0));
        });
      });
    };
  };
};
var evenH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(v) {
    return bind110(asNum1(v))(function(n) {
      return pure1(new VBool(jsMod(n)(2) === 0));
    });
  };
};
var numUnary = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var asNum1 = asNum(dictMonadThrow);
  return function(f) {
    return function(v) {
      return map37(function($1048) {
        return VNumber.create(f($1048));
      })(asNum1(v));
    };
  };
};
var oddH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(v) {
    return bind110(asNum1(v))(function(n) {
      return pure1(new VBool(jsMod(n)(2) !== 0));
    });
  };
};
var relativeH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var liftEither2 = liftEither(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return seamed(dictMonadThrow)("relative")(function(v) {
    return function(args) {
      var v1 = index(args)(1);
      var v2 = index(args)(0);
      if (v2 instanceof Just && v1 instanceof Just) {
        return bind110(asNum1(v2.value0))(function(v3) {
          return bind110(liftEither2(stringify(v1.value0)))(function(unit2) {
            return bind110(liftEither2(stringify(new VNumber(abs(v3)))))(function(magStr) {
              var punit = (function() {
                var $984 = abs(v3) === 1;
                if ($984) {
                  return unit2;
                }
                ;
                return unit2 + "s";
              })();
              return pure1(new VString((function() {
                var $985 = v3 < 0;
                if ($985) {
                  return magStr + (" " + (punit + " ago"));
                }
                ;
                var $986 = v3 > 0;
                if ($986) {
                  return "in " + (magStr + (" " + punit));
                }
                ;
                return "this " + unit2;
              })()));
            });
          });
        });
      }
      ;
      return throwError3(new ArityError("relative: expected at least 2 argument(s), got " + show6(length(args))));
    };
  });
};
var selectPluralH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return seamed(dictMonadThrow)("selectPlural")(function(v) {
    return function(args) {
      var v1 = head(args);
      if (v1 instanceof Nothing) {
        return throwError3(new ArityError("selectPlural: expected at least 1 argument(s), got 0"));
      }
      ;
      if (v1 instanceof Just) {
        return bind110(asNum1(v1.value0))(function(n) {
          return pure1(new VString((function() {
            var $990 = n === 1;
            if ($990) {
              return "one";
            }
            ;
            return "other";
          })()));
        });
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1338, column 50 - line 1342, column 57): " + [v1.constructor.name]);
    };
  });
};
var asInt = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var asNum1 = asNum(dictMonadThrow);
  return function(v) {
    return map37(function($1049) {
      return round2(trunc($1049));
    })(asNum1(v));
  };
};
var atH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asInt1 = asInt(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(av) {
    return function(iv) {
      return bind110(asInt1(iv))(function(i) {
        if (av instanceof VArray) {
          var idx = (function() {
            var $993 = i < 0;
            if ($993) {
              return length(av.value0) + i | 0;
            }
            ;
            return i;
          })();
          return pure1(fromMaybe(VNull.value)(index(av.value0)(idx)));
        }
        ;
        return pure1(VNull.value);
      });
    };
  };
};
var rangeH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asInt1 = asInt(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(a) {
    return function(b) {
      return bind110(asInt1(a))(function(lo) {
        return bind110(asInt1(b))(function(hi) {
          var $995 = hi < lo;
          if ($995) {
            return pure1(new VArray([]));
          }
          ;
          var $996 = ((hi - lo | 0) + 1 | 0) > rangeBudget;
          if ($996) {
            return throwError3(new HelperError("range: " + (show6((hi - lo | 0) + 1 | 0) + (" elements exceed the limit of " + show6(rangeBudget)))));
          }
          ;
          return pure1(new VArray(map15(function($1050) {
            return VNumber.create(toNumber($1050));
          })(range2(lo)(hi))));
        });
      });
    };
  };
};
var sliceH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var slice1 = function(sv) {
        return function(startv) {
          return function(mEndv) {
            return bind110(stringifyM1(sv))(function(s) {
              return bind110(asInt1(startv))(function(start) {
                var len = length2(s);
                return bind110((function() {
                  if (mEndv instanceof Nothing) {
                    return pure1(len);
                  }
                  ;
                  if (mEndv instanceof Just) {
                    return asInt1(mEndv.value0);
                  }
                  ;
                  throw new Error("Failed pattern match at Kernel.Prelude (line 862, column 12 - line 864, column 30): " + [mEndv.constructor.name]);
                })())(function(end) {
                  var lo = clampIndex(len)(start);
                  var hi = clampIndex(len)(end);
                  return pure1(new VString((function() {
                    var $999 = lo >= hi;
                    if ($999) {
                      return "";
                    }
                    ;
                    return take2(hi - lo | 0)(drop2(lo)(s));
                  })()));
                });
              });
            });
          };
        };
      };
      if (args.length === 2) {
        return slice1(args[0])(args[1])(Nothing.value);
      }
      ;
      if (args.length === 3) {
        return slice1(args[0])(args[1])(new Just(args[2]));
      }
      ;
      return throwError3(new ArityError("slice: expected 2 or 3 arguments, got " + show6(length(args))));
    };
  };
};
var takeWith = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asInt1 = asInt(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(f) {
    return function(av) {
      return function(nv) {
        return bind110(asInt1(nv))(function(n) {
          if (av instanceof VArray) {
            return pure1(new VArray(f(max3(0)(n))(av.value0)));
          }
          ;
          return pure1(new VArray([]));
        });
      };
    };
  };
};
var takeH = function(dictMonadThrow) {
  return takeWith(dictMonadThrow)(take);
};
var takeRightH = function(dictMonadThrow) {
  return takeWith(dictMonadThrow)(takeEnd);
};
var toFixedH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(nv) {
    return function(dv) {
      return bind110(asNum1(nv))(function(n) {
        return bind110(asInt1(dv))(function(d) {
          return pure1(new VString(toStringWith(fixed(d))(n)));
        });
      });
    };
  };
};
var truncateH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var truncate1 = function(sv) {
        return function(nv) {
          return function(suf) {
            return bind110(stringifyM1(sv))(function(s) {
              return bind110(asInt1(nv))(function(n) {
                return pure1(new VString((function() {
                  var $1008 = length2(s) > n;
                  if ($1008) {
                    return take2(n)(s) + suf;
                  }
                  ;
                  return s;
                })()));
              });
            });
          };
        };
      };
      if (args.length === 2) {
        return truncate1(args[0])(args[1])("\u2026");
      }
      ;
      if (args.length === 3) {
        return bind110(stringifyM1(args[2]))(function(suf) {
          return truncate1(args[0])(args[1])(suf);
        });
      }
      ;
      return throwError3(new ArityError("truncate: expected 2 or 3 arguments, got " + show6(length(args))));
    };
  };
};
var arityAdmitsZero = function(v) {
  if (v instanceof Exactly) {
    return v.value0 === 0;
  }
  ;
  if (v instanceof AtLeast) {
    return v.value0 === 0;
  }
  ;
  if (v instanceof Between) {
    return v.value0 === 0;
  }
  ;
  if (v instanceof AnyArity) {
    return true;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Prelude (line 1855, column 19 - line 1859, column 19): " + [v.constructor.name]);
};
var arith = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(op) {
    return function(a) {
      return function(b) {
        return bind110(asNum1(a))(function(x) {
          return bind110(asNum1(b))(function(y) {
            return pure1(new VNumber(op(x)(y)));
          });
        });
      };
    };
  };
};
var applyH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just && v.value0.head instanceof VString) {
        var v1 = lookupOperation(v.value0.head.value0)(ctl.env);
        if (v1 instanceof Just) {
          return v1.value0(ctl)(v.value0.tail);
        }
        ;
        if (v1 instanceof Nothing) {
          return throwError3(new UnknownHelper(v.value0.head.value0));
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1886, column 40 - line 1888, column 47): " + [v1.constructor.name]);
      }
      ;
      return throwError3(new $$TypeError("apply: first argument must be a helper-name string"));
    };
  };
};
var coreOperationDefs = function(dictMonadThrow) {
  var Applicative0 = dictMonadThrow.Monad0().Applicative0();
  var valDef1 = valDef(dictMonadThrow);
  var nullary2 = nullary(dictMonadThrow);
  var pure1 = pure(Applicative0);
  var unary2 = unary(dictMonadThrow);
  var binary2 = binary(dictMonadThrow);
  var ne$prime1 = ne$prime(Applicative0);
  var cmp1 = cmp(Applicative0);
  var boolH1 = boolH(Applicative0);
  var arith1 = arith(dictMonadThrow);
  return [gen("this")("The current context.")(false)(new Exactly(0))(thisH(Applicative0)), gen("lookup")("Indexes a value by each key or index in turn, returning null at the first miss.")(false)(new AtLeast(1))(lookupH(dictMonadThrow)), gen("t")("Translates a message key via the host's i18n callback; returns the key unchanged when no translator is registered (ADR-029 fallback-and-flag).")(false)(new AtLeast(1))(translateH(dictMonadThrow)), gen("number")("Formats a number for the host's locale (Intl.NumberFormat); returns the number's plain text when no host formatter is registered (ADR-029).")(false)(new AtLeast(1))(numberH(dictMonadThrow)), gen("date")("Formats a date value for the host's locale (Intl.DateTimeFormat); returns the value's plain text when no host formatter is registered (ADR-029).")(false)(new AtLeast(1))(dateH(dictMonadThrow)), gen("selectPlural")("Returns the CLDR plural category for a number in the host's locale; falls back to the English one/other rule when no host rule is registered (ADR-029).")(false)(new AtLeast(1))(selectPluralH(dictMonadThrow)), gen("relative")("Formats a relative time (value, unit) for the host's locale (Intl.RelativeTimeFormat); falls back to a plain English phrasing when no host formatter is registered (ADR-029).")(false)(new AtLeast(2))(relativeH(dictMonadThrow)), valDef1("true")("The boolean literal true.")(nullary2(pure1(new VBool(true)))), valDef1("false")("The boolean literal false.")(nullary2(pure1(new VBool(false)))), valDef1("null")("The null literal.")(nullary2(pure1(VNull.value))), valDef1("escapeHtml")("HTML-escapes its argument and marks it safe; idempotent on already-safe values.")(unary2(escHtml(dictMonadThrow))), valDef1("safe")("Marks its argument as safe (trusted) markup, without escaping.")(unary2(safe2(dictMonadThrow))), gen("json")("Serializes its argument as JSON text (optionally pretty-printed).")(false)(new Between(1, 2))(jsonH(dictMonadThrow)), gen("escapeJson")("Serializes its argument as JSON and HTML-escapes it, for safe embedding in HTML.")(false)(new Between(1, 2))(escJsonH(dictMonadThrow)), gen("raw")("A raw block that returns its body verbatim, untouched by the engine.")(true)(AnyArity.value)(rawH(dictMonadThrow)), gen("if")("Renders its body when the condition is truthy, else the {{elif}}/{{else}} clauses.")(true)(new Between(1, 2))(ifH(dictMonadThrow)), gen("unless")("Renders its body when the condition is falsy \u2014 the inverse of if.")(true)(new Between(1, 2))(unlessH(dictMonadThrow)), gen("each")("Iterates an array or object, installing the loop's scoped variables per item.")(true)(new AtLeast(1))(eachH(dictMonadThrow)), gen("with")("Shifts the context to its argument for the body (else the {{else}} clause).")(true)(new AtLeast(1))(withH(dictMonadThrow)), gen("local")("Bounded binding: installs its hash's name=value pairs as block-scoped nullary operations for the body, without re-rooting the context, discarded at its close (RawBars/MaxBars `{% local a=1 %}\u2026{% endlocal %}`; docs-17).")(true)(AnyArity.value)(letH(dictMonadThrow)), gen("case")("Routes to the first {{when}} arm whose value equals the subject (evaluated once), else the {{else}} clause (RawBars/MaxBars `{{#case s}}{{when \u2026}}\u2026{{/case}}`).")(true)(new Exactly(1))(caseH(dictMonadThrow)), valDef1("else")("A clause separator the enclosing block splits on; renders nothing on its own.")(nullary2(pure1(new VSafe("")))), gen("when")("A case arm the enclosing case matches against its subject; renders nothing on its own.")(false)(AnyArity.value)(function(v) {
    return function(v1) {
      return pure1(new VSafe(""));
    };
  }), gen("elif")("An else-if clause the enclosing if evaluates; renders nothing on its own.")(false)(new Between(1, 2))(function(v) {
    return function(v1) {
      return pure1(new VSafe(""));
    };
  }), gen("dict")("Builds an object from alternating key/value arguments (the hash target).")(false)(AnyArity.value)(dictH(dictMonadThrow)), valDef1("bind")('Builds a one-key object `{ name: value }` \u2014 the `{{#let (bind "name" value)}}` binding form (RawBars canonical, ADR-024).')(binary2(bindH(dictMonadThrow))), gen("apply")("Calls a helper named by a string argument with the remaining arguments.")(true)(new AtLeast(1))(applyH(dictMonadThrow)), gen("partial")("Renders a registered partial; the context defaults to the current one, options are an optional hash, and a block body is the fallback.")(false)(new Between(1, 3))(partialH(dictMonadThrow)), gen("inline")("Defines a partial from its body, hoisted before rendering; emits nothing.")(true)(new AtLeast(1))(inlineH(Applicative0)), valDef1("eq")("True when its two arguments are equal.")(binary2(eq$prime(Applicative0))), valDef1("ne")("True when its two arguments are not equal.")(binary2(ne$prime1)), valDef1("lt")("True when the first argument is less than the second.")(binary2(cmp1(function(v) {
    return eq23(v)(LT.value);
  }))), valDef1("gt")("True when the first argument is greater than the second.")(binary2(cmp1(function(v) {
    return eq23(v)(GT.value);
  }))), valDef1("lte")("True when the first argument is less than or equal to the second.")(binary2(cmp1(function(v) {
    return notEq12(v)(GT.value);
  }))), valDef1("gte")("True when the first argument is greater than or equal to the second.")(binary2(cmp1(function(v) {
    return notEq12(v)(LT.value);
  }))), withSynonym("ne")(valDef1("isnt")("True when its two arguments are not equal.")(binary2(ne$prime1))), gen("not")("Logical negation of its argument's truthiness.")(false)(new Exactly(1))(notH(dictMonadThrow)), gen("and")("True when every argument is truthy.")(false)(AnyArity.value)(boolH1(all2)), gen("or")("True when any argument is truthy.")(false)(AnyArity.value)(boolH1(any2)), valDef1("add")("Adds two numbers \u2014 the `+` operator's helper.")(binary2(arith1(add1))), valDef1("subtract")("Subtracts the second number from the first \u2014 the `-` operator's helper.")(binary2(arith1(sub2))), valDef1("multiply")("Multiplies two numbers \u2014 the `*` operator's helper.")(binary2(arith1(mul2))), valDef1("divide")("Divides the first number by the second \u2014 the `/` operator's helper.")(binary2(arith1(div4))), valDef1("modulo")("The remainder of dividing the first number by the second \u2014 the `%` operator's helper.")(binary2(arith1(jsMod))), withAlias("add")(valDef1("plus")("Adds two numbers.")(binary2(arith1(add1)))), withAlias("subtract")(valDef1("minus")("Subtracts the second number from the first.")(binary2(arith1(sub2)))), withAlias("multiply")(valDef1("times")("Multiplies two numbers.")(binary2(arith1(mul2)))), gen("coalesce")("Returns the first non-null argument \u2014 the `??` operator's helper.")(false)(new AtLeast(1))(coalesceH(dictMonadThrow)), gen("firstTruthy")("Returns the first truthy argument \u2014 the `?:` (Elvis) operator's helper.")(false)(new AtLeast(1))(firstTruthyH(dictMonadThrow)), gen("ternary")("Returns the 2nd argument when the 1st is truthy, else the 3rd \u2014 the `? :` ternary operator's helper.")(false)(new Exactly(3))(ternaryH(dictMonadThrow)), valDef1("log")("Logs its arguments to the host and returns null.")(atLeast(dictMonadThrow)(1)($$const(pure1(VNull.value))))];
};
var appendH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind110 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure1 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      return bind110(stringifyM1(sv))(function(s) {
        return bind110(stringifyM1(xv))(function(x) {
          return pure1(new VString(s + x));
        });
      });
    };
  };
};
var primitiveOperationDefs = function(dictMonadThrow) {
  var valDef1 = valDef(dictMonadThrow);
  var unary2 = unary(dictMonadThrow);
  var strUnary1 = strUnary(dictMonadThrow);
  var binary2 = binary(dictMonadThrow);
  var numUnary1 = numUnary(dictMonadThrow);
  var Applicative0 = dictMonadThrow.Monad0().Applicative0();
  var countH1 = countH(Applicative0);
  return [valDef1("lowercase")("Lowercases its argument.")(unary2(strUnary1(toLower))), valDef1("uppercase")("Uppercases its argument.")(unary2(strUnary1(toUpper))), valDef1("capitalize")("Uppercases the first character of its argument.")(unary2(strUnary1(capitalizeStr))), valDef1("trim")("Removes leading and trailing whitespace.")(unary2(strUnary1(trim))), valDef1("trimStart")("Removes leading whitespace.")(unary2(strUnary1(trimStartStr))), valDef1("trimEnd")("Removes trailing whitespace.")(unary2(strUnary1(trimEndStr))), valDef1("split")("Splits a string into an array on a separator.")(binary2(splitH(dictMonadThrow))), gen("replace")("Replaces every occurrence of a substring with another.")(false)(new Exactly(3))(replaceH(dictMonadThrow)), gen("slice")("Returns a substring from a start index to an optional end index.")(false)(new Between(2, 3))(sliceH(dictMonadThrow)), valDef1("includes")("True when the subject string or array contains the given value.")(binary2(includesH(dictMonadThrow))), valDef1("startsWith")("True when the string starts with the given prefix.")(binary2(startsWithH(dictMonadThrow))), valDef1("endsWith")("True when the string ends with the given suffix.")(binary2(endsWithH(dictMonadThrow))), gen("truncate")("Shortens a string to a maximum length, appending an optional ellipsis.")(false)(new Between(2, 3))(truncateH(dictMonadThrow)), valDef1("append")("Appends the second string to the first.")(binary2(appendH(dictMonadThrow))), valDef1("prepend")("Prepends the second string to the first.")(binary2(prependH(dictMonadThrow))), valDef1("concat")("Concatenates two strings \u2014 the `~` operator's helper.")(binary2(concatH(dictMonadThrow))), withAlias("lowercase")(valDef1("downcase")("Lowercases its argument.")(unary2(strUnary1(toLower)))), withAlias("uppercase")(valDef1("upcase")("Uppercases its argument.")(unary2(strUnary1(toUpper)))), valDef1("abs")("The absolute value of a number.")(unary2(numUnary1(abs))), valDef1("floor")("Rounds a number down to the nearest integer.")(unary2(numUnary1(floor))), valDef1("ceil")("Rounds a number up to the nearest integer.")(unary2(numUnary1(ceil))), valDef1("round")("Rounds a number to the nearest integer.")(unary2(numUnary1(round))), valDef1("even")("True when the number is even.")(unary2(evenH(dictMonadThrow))), valDef1("odd")("True when the number is odd.")(unary2(oddH(dictMonadThrow))), valDef1("divisibleBy")("True when the first number is divisible by the second.")(binary2(divisibleByH(dictMonadThrow))), valDef1("toFixed")("Formats a number with a fixed number of decimal places.")(binary2(toFixedH(dictMonadThrow))), valDef1("toInt")("Parses its argument as an integer.")(unary2(toIntH(dictMonadThrow))), valDef1("toFloat")("Parses its argument as a floating-point number.")(unary2(toFloatH(dictMonadThrow))), valDef1("join")("Joins an array into a string with a separator.")(binary2(joinH(dictMonadThrow))), valDef1("count")("The number of items in an array (or characters in a string).")(unary2(countH1)), withSynonym("count")(valDef1("size")("The number of items in an array (or characters in a string).")(unary2(countH1))), valDef1("at")("The element at an index (negative counts from the end).")(binary2(atH(dictMonadThrow))), valDef1("list")("Builds an array from its arguments (the `[\u2026]` list-literal helper).")(variadic((function() {
    var $1051 = pure(Applicative0);
    return function($1052) {
      return $1051(VArray.create($1052));
    };
  })())), valDef1("range")("The inclusive integer range [a, b] as an array (the `..` operator's helper).")(binary2(rangeH(dictMonadThrow))), valDef1("take")("The first n elements of an array.")(binary2(takeH(dictMonadThrow))), valDef1("takeRight")("The last n elements of an array.")(binary2(takeRightH(dictMonadThrow))), valDef1("reverse")("Reverses an array or string.")(unary2(reverseH(dictMonadThrow))), valDef1("unique")("The array with duplicate elements removed.")(unary2(uniqueH(Applicative0))), valDef1("sortBy")("Sorts an array of objects by a key.")(binary2(sortByH(dictMonadThrow))), valDef1("pluck")("Extracts a key's value from each object in an array.")(binary2(pluckH(dictMonadThrow))), valDef1("groupBy")("Groups an array of objects into an object keyed by a field.")(binary2(groupByH(dictMonadThrow))), gen("where")("Keeps array items whose key is truthy, equals, or compares to a value.")(false)(new Between(2, 4))(whereH(dictMonadThrow)), gen("reject")("Keeps array items whose key is falsy, or fails the value/comparator test.")(false)(new Between(2, 4))(rejectH(dictMonadThrow)), gen("find")("The first array item whose key is truthy, equals, or compares to a value (else null).")(false)(new Between(2, 4))(findH(dictMonadThrow)), gen("some")("True when any array item's key is truthy, equals, or compares to a value.")(false)(new Between(2, 4))(someH(dictMonadThrow)), gen("every")("True when every array item's key is truthy, equals, or compares to a value.")(false)(new Between(2, 4))(everyH(dictMonadThrow))];
};
var operationDefs = function(dictMonadThrow) {
  return append12(coreOperationDefs(dictMonadThrow))(primitiveOperationDefs(dictMonadThrow));
};
var operationDefs1 = /* @__PURE__ */ operationDefs(monadThrowEither);
var blockHelperNames = /* @__PURE__ */ mapMaybe(function(d) {
  if (d.block) {
    return new Just(d.name);
  }
  ;
  return Nothing.value;
})(operationDefs1);
var prelude = function(dictMonadThrow) {
  return map15(function(d) {
    return new Tuple(d.name, d.run);
  })(operationDefs(dictMonadThrow));
};
var preludeAliases = /* @__PURE__ */ mapMaybe(function(d) {
  return map23(Tuple.create(d.name))(d.alias);
})(operationDefs1);
var sectionableValueNames = /* @__PURE__ */ (function() {
  var pick = function(d) {
    if (d.block) {
      return Nothing.value;
    }
    ;
    if (arityAdmitsZero(d.arity)) {
      return Nothing.value;
    }
    ;
    if (otherwise) {
      return new Just(d.name);
    }
    ;
    throw new Error("Failed pattern match at Kernel.Prelude (line 1849, column 3 - line 1852, column 30): " + [d.constructor.name]);
  };
  return mapMaybe(pick)(operationDefs1);
})();
var lenientResolve = function(dictMonadThrow) {
  var pure1 = pure(dictMonadThrow.Monad0().Applicative0());
  var valueOrSection1 = valueOrSection(dictMonadThrow);
  var sectionOp1 = sectionOp(dictMonadThrow);
  return function(env) {
    return function(name2) {
      return function(v) {
        if (v instanceof Just) {
          if (isScopedBinding(name2)(env)) {
            return pure1(v.value0);
          }
          ;
          if (elem12(name2)(sectionableValueNames)) {
            return pure1(valueOrSection1(name2)(v.value0));
          }
          ;
          if (otherwise) {
            return pure1(v.value0);
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure1(sectionOp1(name2));
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1795, column 27 - line 1804, column 35): " + [v.constructor.name]);
      };
    };
  };
};

// output/Kernel.Render/index.js
var map17 = /* @__PURE__ */ map(functorArray);
var show7 = /* @__PURE__ */ show(showError);
var preludeEnv = function(dictMonadThrow) {
  var prelude2 = prelude(dictMonadThrow);
  var constOperation3 = constOperation(dictMonadThrow.Monad0().Applicative0());
  return function(dat) {
    return registerAll(prelude2)(register("root")(constOperation3(dat))(emptyEnv(dat)));
  };
};
var runResolvedUsing = function(dictMonadThrow) {
  var runTemplate9 = runTemplate(dictMonadThrow.Monad0());
  var preludeEnv1 = preludeEnv(dictMonadThrow);
  return function(toEngine) {
    return function(_directives) {
      return function(setup) {
        return function(nodes) {
          return function(dat) {
            return runTemplate9(toEngine(setup(preludeEnv1(dat))))(nodes);
          };
        };
      };
    };
  };
};
var runResolved = function(dictMonadThrow) {
  return runResolvedUsing(dictMonadThrow)(refEngine(dictMonadThrow));
};
var runResolvedLenient = function(dictMonadThrow) {
  return runResolvedUsing(dictMonadThrow)(refEngineWith(dictMonadThrow)(lenientResolve(dictMonadThrow)));
};
var formatError = function(src) {
  return function(v) {
    if (v instanceof ParseFailure) {
      return joinWith("\n")(map17(renderParseErrorAt(src))(toArray(v.value0)));
    }
    ;
    return show7(v);
  };
};

// output/Kernel.Analyse/index.js
var bind5 = /* @__PURE__ */ bind(bindMaybe);
var mapFlipped2 = /* @__PURE__ */ mapFlipped(functorMaybe);
var nub2 = /* @__PURE__ */ nub(ordString);
var append13 = /* @__PURE__ */ append(semigroupArray);
var map18 = /* @__PURE__ */ map(functorArray);
var show8 = /* @__PURE__ */ show(showNumber);
var show12 = /* @__PURE__ */ show(showBoolean);
var elem6 = /* @__PURE__ */ elem2(eqString);
var show22 = /* @__PURE__ */ show(showInt);
var monadThrowWriterT2 = /* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither);
var bindWriterT2 = /* @__PURE__ */ bindWriterT(semigroupArray)(bindEither);
var bind1 = /* @__PURE__ */ bind(bindWriterT2);
var discard3 = /* @__PURE__ */ discard(discardUnit)(bindWriterT2);
var member3 = /* @__PURE__ */ member(ordString);
var tell2 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var applicativeWriterT2 = /* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither);
var pure4 = /* @__PURE__ */ pure(applicativeWriterT2);
var lookup6 = /* @__PURE__ */ lookup2(ordString);
var for_2 = /* @__PURE__ */ for_(applicativeWriterT2)(foldableArray);
var preludeEnv2 = /* @__PURE__ */ preludeEnv(monadThrowWriterT2);
var mapFlipped1 = /* @__PURE__ */ mapFlipped(functorEither);
var runTemplate2 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
var sameTypeAmbiguous = function(v) {
  if (v instanceof VNumber && v.value0 !== 0) {
    return new Just(new VNumber(0));
  }
  ;
  if (v instanceof VString && v.value0 !== "") {
    return new Just(new VString(""));
  }
  ;
  if (v instanceof VSafe && v.value0 !== "") {
    return new Just(new VString(""));
  }
  ;
  if (v instanceof VArray && !$$null(v.value0)) {
    return new Just(new VArray([]));
  }
  ;
  if (v instanceof VObject && !isEmpty(v.value0)) {
    return new Just(new VObject(empty2));
  }
  ;
  return Nothing.value;
};
var recoverPath = function(tag) {
  var stripBraces = function(s) {
    return replaceAll("{{")("")(replaceAll("}}")("")(s));
  };
  var pathChar = function(c) {
    return c >= "a" && c <= "z" || (c >= "A" && c <= "Z" || (c >= "0" && c <= "9" || (c === "." || (c === "_" || c === "-"))));
  };
  var dropSigil = function(s) {
    return replaceAll("#")("")(replaceAll("^")("")(s));
  };
  var dropKeyword = function(s) {
    var v = uncons(split(" ")(s));
    if (v instanceof Just && (v.value0.head === "if" || (v.value0.head === "unless" || (v.value0.head === "and" || (v.value0.head === "or" || v.value0.head === "not"))))) {
      return joinWith(" ")(v.value0.tail);
    }
    ;
    return s;
  };
  var inner = trim(dropSigil(stripBraces(tag)));
  var body = trim(dropKeyword(inner));
  var $76 = body !== "" && all2(pathChar)(toCharArray(body));
  if ($76) {
    return new Just(body);
  }
  ;
  return Nothing.value;
};
var namedRules = /* @__PURE__ */ (function() {
  return [new Tuple("handlebars", handlebars), new Tuple("mustache-spec", mustache), new Tuple("minimal", minimal), new Tuple("presence", presence)];
})();
var missFindings = function(schema) {
  return function(src) {
    return function(decisions) {
      var toMiss = function(d) {
        return bind5(recoverPath(trim(spanText(src)(d.span))))(function(p) {
          var $77 = schema(p)(VNull.value);
          if ($77) {
            var lc = lineColumn(src)(d.span.start);
            return new Just({
              kind: "miss",
              line: lc.line,
              column: lc.column,
              tag: trim(spanText(src)(d.span)),
              value: "absent (resolved to null)",
              flips: [],
              fix: "check the spelling of `" + (p + ("`, or guard it: `{{#if " + (p + "}}\u2026{{/if}}`."))),
              path: p
            });
          }
          ;
          return Nothing.value;
        });
      };
      var sameTag = function(a) {
        return function(b) {
          return a.path === b.path;
        };
      };
      return nubByEq(sameTag)(mapMaybe(toMiss)(filter(function(d) {
        return d.kind === "miss";
      })(decisions)));
    };
  };
};
var isFinding = function(d) {
  return d.kind === "cond" && !$$null(d.diverges);
};
var jsonataScaffold = function(src) {
  return function(decisions) {
    var parentOf = function(p) {
      var v = lastIndexOf2(".")(p);
      if (v instanceof Just) {
        return take2(v.value0)(p);
      }
      ;
      if (v instanceof Nothing) {
        return "$";
      }
      ;
      throw new Error("Failed pattern match at Kernel.Analyse (line 505, column 16 - line 507, column 19): " + [v.constructor.name]);
    };
    var normOf = function(p) {
      return function(v) {
        if (v instanceof VString && v.value0 === "") {
          return p + (' = "" ? null : ' + p);
        }
        ;
        if (v instanceof VNumber) {
          return p + (" = 0 ? null : " + p);
        }
        ;
        if (v instanceof VArray) {
          return "$count(" + (p + (") = 0 ? null : " + p));
        }
        ;
        if (v instanceof VObject) {
          return "$keys(" + (p + (") ? " + (p + " : null")));
        }
        ;
        return p;
      };
    };
    var leafOf = function(p) {
      var v = lastIndexOf2(".")(p);
      if (v instanceof Just) {
        return drop2(v.value0 + 1 | 0)(p);
      }
      ;
      if (v instanceof Nothing) {
        return p;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Analyse (line 508, column 14 - line 510, column 17): " + [v.constructor.name]);
    };
    var jsq = function(s) {
      return '"' + (s + '"');
    };
    var scaffoldLine = function(d) {
      return mapFlipped2(recoverPath(trim(spanText(src)(d.span))))(function(p) {
        return "$ ~> |" + (parentOf(p) + ("|{ " + (jsq(leafOf(p)) + (": " + (normOf(p)(d.value) + " }|")))));
      });
    };
    var flagged = filter(isFinding)(decisions);
    var transforms = nub2(mapMaybe(scaffoldLine)(flagged));
    var computedNote = function(d) {
      var v = recoverPath(trim(spanText(src)(d.span)));
      if (v instanceof Just) {
        return Nothing.value;
      }
      ;
      if (v instanceof Nothing) {
        return new Just("(* computed condition, not path-targetable: " + (trim(spanText(src)(d.span)) + " *)"));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Analyse (line 500, column 20 - line 503, column 98): " + [v.constructor.name]);
    };
    var computed = nub2(mapMaybe(computedNote)(flagged));
    return joinWith("\n")(append13(["(* Truthiness cleanup scaffold (ADR-022) \u2014 REVIEW each rule before applying. *)", "(* Each path resolved to an engine-ambiguous value in a condition. *)"])(append13((function() {
      var $89 = $$null(transforms);
      if ($89) {
        return ["(* no bare-path findings to normalise *)"];
      }
      ;
      return transforms;
    })())((function() {
      var $90 = $$null(computed);
      if ($90) {
        return [];
      }
      ;
      return append13([""])(computed);
    })())));
  };
};
var fixForHandlebars = function(v) {
  if (v instanceof VString && v.value0 === "") {
    return 'make it explicit and rule-free: `(ne s "")` / `(eq s "")`.';
  }
  ;
  if (v instanceof VNumber) {
    return "if 0 should count, `includeZero=true` (Handlebars-only \u2014 not portable); for portability test explicitly: `(ne x 0)`.";
  }
  ;
  if (v instanceof VArray) {
    return "iterate instead \u2014 `{{#each xs}}\u2026{{else}}\u2026{{/each}}` renders `else` on empty on every engine.";
  }
  ;
  if (v instanceof VObject) {
    return "only the `presence` rule calls `{}` falsy; test a known key explicitly.";
  }
  ;
  return "branch explicitly so the decision does not ride on the host's truthiness rule.";
};
var handlebarsLabels = /* @__PURE__ */ (function() {
  return {
    engineRule: "handlebars",
    rule: handlebars,
    fix: fixForHandlebars,
    legend: '_The engine `handlebars` rule is also `mustache.js`\' (`0`/`""` falsy), so a finding\'s `flips under` names the engines that branch the *other* way \u2014 `mustache-spec` is the language-agnostic Mustache/Ruby reading (`0`/`""` truthy), not `mustache.js`._'
  };
})();
var evaluatedCount = /* @__PURE__ */ (function() {
  var $143 = filter(function(d) {
    return d.kind === "cond";
  });
  return function($144) {
    return length($143($144));
  };
})();
var divergence = function(v) {
  return function(here) {
    return filter(function(t) {
      return snd(t) !== here;
    })(map18(function(t) {
      return new Tuple(fst(t), snd(t)(v));
    })(namedRules));
  };
};
var describe = function(v) {
  if (v instanceof VString && v.value0 === "") {
    return 'an empty string `""`';
  }
  ;
  if (v instanceof VString) {
    return 'a string `"' + (v.value0 + '"`');
  }
  ;
  if (v instanceof VNumber) {
    return "the number `" + ((function() {
      var $99 = v.value0 === 0;
      if ($99) {
        return "0";
      }
      ;
      return show8(v.value0);
    })() + "`");
  }
  ;
  if (v instanceof VBool) {
    return "`" + (show12(v.value0) + "`");
  }
  ;
  if (v instanceof VNull) {
    return "`null`";
  }
  ;
  if (v instanceof VArray) {
    var $102 = $$null(v.value0);
    if ($102) {
      return "an empty array `[]`";
    }
    ;
    return "a non-empty array";
  }
  ;
  if (v instanceof VObject) {
    var $104 = isEmpty(v.value0);
    if ($104) {
      return "an empty object `{}`";
    }
    ;
    return "a non-empty object";
  }
  ;
  if (v instanceof VSafe) {
    return "a safe string";
  }
  ;
  throw new Error("Failed pattern match at Kernel.Analyse (line 448, column 12 - line 456, column 29): " + [v.constructor.name]);
};
var findingAt = function(fix) {
  return function(kind) {
    return function(src) {
      return function(d) {
        return function(v) {
          return function(here) {
            var tagTxt = trim(spanText(src)(d.span));
            var lc = lineColumn(src)(d.span.start);
            return {
              kind,
              line: lc.line,
              column: lc.column,
              tag: tagTxt,
              value: describe(v),
              flips: map18(fst)(divergence(v)(here)),
              fix: fix(v),
              path: (function() {
                var v1 = recoverPath(tagTxt);
                if (v1 instanceof Just) {
                  return v1.value0;
                }
                ;
                if (v1 instanceof Nothing) {
                  return "";
                }
                ;
                throw new Error("Failed pattern match at Kernel.Analyse (line 142, column 13 - line 144, column 22): " + [v1.constructor.name]);
              })()
            };
          };
        };
      };
    };
  };
};
var findings = function(fix) {
  return function(src) {
    var $145 = map18(function(d) {
      return findingAt(fix)("observed")(src)(d)(d.value)(d.truthyHere);
    });
    var $146 = filter(isFinding);
    return function($147) {
      return $145($146($147));
    };
  };
};
var potentialFindings = function(rule) {
  return function(fix) {
    return function(schema) {
      return function(src) {
        return function(decisions) {
          var sameTagValue = function(a) {
            return function(b) {
              return a.tag === b.tag && a.value === b.value;
            };
          };
          var observedPaths = mapMaybe(function(d) {
            var $109 = isFinding(d);
            if ($109) {
              return recoverPath(trim(spanText(src)(d.span)));
            }
            ;
            return Nothing.value;
          })(decisions);
          var toPotential = function(d) {
            return bind5(sameTypeAmbiguous(d.value))(function(av) {
              var finding = findingAt(fix)("potential")(src)(d)(av)(rule(av));
              var $110 = $$null(finding.flips);
              if ($110) {
                return Nothing.value;
              }
              ;
              var $111 = finding.path !== "" && elem6(finding.path)(observedPaths);
              if ($111) {
                return Nothing.value;
              }
              ;
              var $112 = finding.path !== "" && !schema(finding.path)(av);
              if ($112) {
                return Nothing.value;
              }
              ;
              return new Just(finding);
            });
          };
          return nubByEq(sameTagValue)(mapMaybe(toPotential)(decisions));
        };
      };
    };
  };
};
var reportMarkdownWith = function(labels) {
  return function(schema) {
    return function(src) {
      return function(decisions) {
        var verdict = function(b) {
          if (b) {
            return "truthy";
          }
          ;
          return "falsy";
        };
        var tag = function(d) {
          return trim(spanText(src)(d.span));
        };
        var potentials = potentialFindings(labels.rule)(labels.fix)(schema)(src)(decisions);
        var potentialLine = function(f) {
          return "* \u26A0 line " + (show22(f.line) + (" \u2014 `" + (f.tag + ("` would diverge if it held " + (f.value + (" (flips under " + (joinWith(", ")(map18(function(r) {
            return "`" + (r + "`");
          })(f.flips)) + (").  **Fix** \xB7 " + (f.fix + (function() {
            var $114 = f.path !== "";
            if ($114) {
              return "  \xB7  data path: `" + (f.path + "`");
            }
            ;
            return "";
          })())))))))));
        };
        var pathNote = function(v) {
          if (v instanceof Just) {
            return "  \xB7  data path: `" + (v.value0 + "`");
          }
          ;
          if (v instanceof Nothing) {
            return "";
          }
          ;
          throw new Error("Failed pattern match at Kernel.Analyse (line 441, column 14 - line 443, column 18): " + [v.constructor.name]);
        };
        var misses = missFindings(schema)(src)(decisions);
        var missLine = function(f) {
          return "* \u26A0 line " + (show22(f.line) + (" \u2014 `" + (f.path + ("` " + (f.value + (".  **Fix** \xB7 " + f.fix))))));
        };
        var loc = function(d) {
          var lc = lineColumn(src)(d.span.start);
          return "line " + show22(lc.line);
        };
        var flagged = filter(isFinding)(decisions);
        var findingSection = function(d) {
          return joinWith("\n")(["## \u26A0 " + (loc(d) + (" \u2014 `" + (tag(d) + ("` tested " + describe(d.value))))), "Under `" + (labels.engineRule + ("` (engine) this is **" + (verdict(d.truthyHere) + ("**; it flips under " + (joinWith(", ")(map18(function(t) {
            return "`" + (fst(t) + "`");
          })(d.diverges)) + "."))))), "**Fix** \xB7 " + (labels.fix(d.value) + pathNote(recoverPath(tag(d)))), ""]);
        };
        var conds = filter(function(d) {
          return d.kind === "cond";
        })(decisions);
        var cleanLine = function(d) {
          return "* \u2713 " + (loc(d) + (" \u2014 `" + (tag(d) + ("` tested " + (describe(d.value) + " (agrees everywhere)")))));
        };
        var clean = filter(function(d) {
          return d.kind === "cond" && $$null(d.diverges);
        })(decisions);
        return joinWith("\n")(append13(["# Truthiness analysis", "Engine rule: `" + (labels.engineRule + ("` \xB7 " + (show22(length(conds)) + (" condition(s) evaluated \xB7 **" + (show22(length(flagged)) + (" observed**, " + (show22(length(potentials)) + " potential finding(s)"))))))), "", '_Coverage: *observed* findings are conditions this **data** actually drove into the ambiguous four; *potential* findings are the same-type ambiguous value each other condition **could** hold (independent of the sample, so stable for CI). "No observed findings" means portable *for this data*, not for all data \u2014 read the potential section too._', "", labels.legend, ""])(append13((function() {
          var $117 = $$null(flagged);
          if ($117) {
            return ["_No observed portability findings \u2014 every condition agrees across engines for this data._", ""];
          }
          ;
          return map18(findingSection)(flagged);
        })())(append13((function() {
          var $118 = $$null(potentials);
          if ($118) {
            return [];
          }
          ;
          return append13(["## Potential findings (data-independent)", "_These were portable for your data, but the same-type ambiguous value would diverge:_", ""])(append13(map18(potentialLine)(potentials))([""]));
        })())(append13((function() {
          var $119 = $$null(misses);
          if ($119) {
            return [];
          }
          ;
          return append13(["## Possible data-access misses (advisory, for this data)", "_A bare path resolved to absent from a present object \u2014 a likely typo or missing field:_", ""])(append13(map18(missLine)(misses))([""]));
        })())((function() {
          var $120 = $$null(clean);
          if ($120) {
            return [];
          }
          ;
          return append13(["## Portable conditions"])(map18(cleanLine)(clean));
        })())))));
      };
    };
  };
};
var reportMarkdown = /* @__PURE__ */ reportMarkdownWith(handlebarsLabels);
var anyPath = function(v) {
  return function(v1) {
    return true;
  };
};
var analysisWrappers = /* @__PURE__ */ (function() {
  var preludeMap = fromFoldable2(ordString)(foldableArray)(prelude(monadThrowWriterT2));
  var decisionFor = function(name2) {
    return function(ctl) {
      return function(v) {
        var here = refTruthy(ctl.env)(v);
        return {
          kind: "cond",
          span: ctl.span,
          op: name2,
          value: v,
          truthyHere: here,
          diverges: divergence(v)(here)
        };
      };
    };
  };
  var conds = [new Tuple("if", false), new Tuple("unless", false), new Tuple("not", false), new Tuple("and", true), new Tuple("or", true)];
  var analysedLookup = function(orig) {
    return function(ctl) {
      return function(args) {
        return bind1(orig(ctl)(args))(function(r) {
          return discard3((function() {
            var v = uncons(args);
            if (v instanceof Just) {
              var v1 = unsnoc(v.value0.tail);
              if (v1 instanceof Just && v1.value0.last instanceof VString) {
                return bind1(orig(ctl)(cons(v.value0.head)(v1.value0.init)))(function(parent) {
                  if (parent instanceof VObject && (!isEmpty(parent.value0) && !member3(v1.value0.last.value0)(parent.value0))) {
                    return tell2([{
                      kind: "miss",
                      span: ctl.span,
                      op: "lookup",
                      value: VNull.value,
                      truthyHere: false,
                      diverges: []
                    }]);
                  }
                  ;
                  return pure4(unit);
                });
              }
              ;
              return pure4(unit);
            }
            ;
            return pure4(unit);
          })())(function() {
            return pure4(r);
          });
        });
      };
    };
  };
  var lookupWrapper = (function() {
    var v = lookup6("lookup")(preludeMap);
    if (v instanceof Nothing) {
      return [];
    }
    ;
    if (v instanceof Just) {
      return [new Tuple("lookup", analysedLookup(v.value0))];
    }
    ;
    throw new Error("Failed pattern match at Kernel.Analyse (line 275, column 19 - line 277, column 58): " + [v.constructor.name]);
  })();
  var analysed = function(name2) {
    return function(variadic2) {
      return function(orig) {
        return function(ctl) {
          return function(args) {
            var tested = (function() {
              if (variadic2) {
                return args;
              }
              ;
              return take(1)(args);
            })();
            return discard3(for_2(tested)(function(v) {
              return tell2([decisionFor(name2)(ctl)(v)]);
            }))(function() {
              return orig(ctl)(args);
            });
          };
        };
      };
    };
  };
  var wrap3 = function(v) {
    var v1 = lookup6(v.value0)(preludeMap);
    if (v1 instanceof Nothing) {
      return Nothing.value;
    }
    ;
    if (v1 instanceof Just) {
      return new Just(new Tuple(v.value0, analysed(v.value0)(v.value1)(v1.value0)));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Analyse (line 252, column 32 - line 254, column 65): " + [v1.constructor.name]);
  };
  return append13(mapMaybe(wrap3)(conds))(lookupWrapper);
})();
var runAnalysis = function(toEngine) {
  return function(setup) {
    return function(nodes) {
      return function(dat) {
        var env = registerAll(analysisWrappers)(setup(preludeEnv2(dat)));
        return mapFlipped1(runWriterT(runTemplate2(toEngine(env))(nodes)))(function(v) {
          return {
            output: v.value0,
            decisions: v.value1
          };
        });
      };
    };
  };
};
var allFindings = function(labels) {
  return function(schema) {
    return function(src) {
      return function(decisions) {
        return append13(findings(labels.fix)(src)(decisions))(append13(potentialFindings(labels.rule)(labels.fix)(schema)(src)(decisions))(missFindings(schema)(src)(decisions)));
      };
    };
  };
};

// output/Kernel.CaseSugar/index.js
var elem7 = /* @__PURE__ */ elem2(eqString);
var nodeStart = function(v) {
  if (v instanceof Content) {
    return v.value0.start;
  }
  ;
  if (v instanceof Output) {
    return v.value0.start;
  }
  ;
  if (v instanceof Block) {
    return v.value0.start;
  }
  ;
  if (v instanceof RawBlock) {
    return v.value0.start;
  }
  ;
  if (v instanceof Sep) {
    return v.value0.start;
  }
  ;
  if (v instanceof NodeError) {
    return v.value0.start;
  }
  ;
  throw new Error("Failed pattern match at Kernel.CaseSugar (line 100, column 13 - line 106, column 29): " + [v.constructor.name]);
};
var caseLeadingViolation = function(nodes) {
  var leadingOffset = function($copy_nodes$prime) {
    var $tco_done = false;
    var $tco_result;
    function $tco_loop(nodes$prime) {
      var v = uncons(nodes$prime);
      if (v instanceof Just && (v.value0.head instanceof Sep && v.value0.head.value1 === "when")) {
        $tco_done = true;
        return Nothing.value;
      }
      ;
      if (v instanceof Just && (v.value0.head instanceof Sep && v.value0.head.value1 === "else")) {
        $tco_done = true;
        return Nothing.value;
      }
      ;
      if (v instanceof Just && (v.value0.head instanceof Content && trim(v.value0.head.value1) === "")) {
        $copy_nodes$prime = v.value0.tail;
        return;
      }
      ;
      if (v instanceof Just) {
        $tco_done = true;
        return new Just(nodeStart(v.value0.head));
      }
      ;
      if (v instanceof Nothing) {
        $tco_done = true;
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at Kernel.CaseSugar (line 33, column 26 - line 38, column 23): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($copy_nodes$prime);
    }
    ;
    return $tco_result;
  };
  var node2 = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "case")) {
      var v1 = leadingOffset(v.value4);
      if (v1 instanceof Just) {
        return new Just({
          off: v1.value0,
          shape: "{{#case}} (only whitespace may precede the first {{when}} \u2014 move leading content into a {{when}}/{{else}} arm)"
        });
      }
      ;
      if (v1 instanceof Nothing) {
        return caseLeadingViolation(v.value4);
      }
      ;
      throw new Error("Failed pattern match at Kernel.CaseSugar (line 28, column 38 - line 30, column 43): " + [v1.constructor.name]);
    }
    ;
    if (v instanceof Block) {
      return caseLeadingViolation(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node2)(nodes));
};
var braceControlViolation = function(clauses) {
  return function(src) {
    return function(nodes) {
      var sepShape = function(name2) {
        return "{{" + (name2 + (" \u2026}} (a clause separator uses a {% \u2026 %} tag in this dialect \u2014 write {% " + (name2 + " \u2026 %})")));
      };
      var isBrace = function(sp) {
        return take2(2)(drop2(sp.start)(src)) === "{{";
      };
      var blockShape = function(name2) {
        return "{{#" + (name2 + (" \u2026}} (control flow uses Django-style {% \u2026 %} tags in this dialect \u2014 write {% " + (name2 + (" \u2026 %} \u2026 {% end" + (name2 + " %})")))));
      };
      var node2 = function(v) {
        if (v instanceof Block) {
          if (isBrace(v.value0)) {
            return new Just({
              off: v.value0.start,
              shape: blockShape(v.value2)
            });
          }
          ;
          if (otherwise) {
            return braceControlViolation(clauses)(src)(v.value4);
          }
          ;
        }
        ;
        if (v instanceof Sep) {
          if (isBrace(v.value0) && elem7(v.value1)(clauses)) {
            return new Just({
              off: v.value0.start,
              shape: sepShape(v.value1)
            });
          }
          ;
          if (isBrace(v.value0) && take2(1)(v.value1) === ">") {
            return new Just({
              off: v.value0.start,
              shape: '{{> name}} (a partial include uses a {% \u2026 %} tag in this dialect \u2014 write {% include "name" %})'
            });
          }
          ;
          if (isBrace(v.value0) && v.value1 === "yield") {
            return new Just({
              off: v.value0.start,
              shape: "{{yield}} (the block-partial slot uses a {% \u2026 %} tag in this dialect \u2014 write {% yield %})"
            });
          }
          ;
        }
        ;
        if (v instanceof RawBlock && (isBrace(v.value0) && v.value1 === "raw")) {
          return new Just({
            off: v.value0.start,
            shape: "{{{{#raw}}}} \u2026 {{{{/raw}}}} (a verbatim region uses a {% \u2026 %} tag in this dialect \u2014 write {% raw %} \u2026 {% endraw %})"
          });
        }
        ;
        return Nothing.value;
      };
      return head(mapMaybe(node2)(nodes));
    };
  };
};

// output/Kernel.Hoist/index.js
var union5 = /* @__PURE__ */ union(ordString);
var insert6 = /* @__PURE__ */ insert(ordString);
var hoistInline = function(nodes) {
  var inlineName = function(args) {
    var v = head(args);
    if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
      return new Just(v.value0.value0.value0);
    }
    ;
    return Nothing.value;
  };
  var step2 = function(acc) {
    return function(v) {
      var v1 = function(v2) {
        if (v instanceof Block) {
          var inner2 = hoistInline(v.value4);
          return {
            partials: union5(acc.partials)(inner2.partials),
            template: snoc(acc.template)(new Block(v.value0, v.value1, v.value2, v.value3, inner2.template))
          };
        }
        ;
        return {
          partials: acc.partials,
          template: snoc(acc.template)(v)
        };
      };
      if (v instanceof Block && v.value2 === "inline") {
        var $20 = inlineName(v.value3);
        if ($20 instanceof Just) {
          var inner = hoistInline(v.value4);
          return {
            template: acc.template,
            partials: insert6($20.value0)(inner.template)(union5(acc.partials)(inner.partials))
          };
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
  return foldl2(step2)({
    partials: empty2,
    template: []
  })(nodes);
};

// output/Kernel.Inherit/index.js
var $runtime_lazy4 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var union6 = /* @__PURE__ */ union(ordString);
var insert7 = /* @__PURE__ */ insert(ordString);
var discard4 = /* @__PURE__ */ discard(discardUnit)(bindEither);
var traverse_2 = /* @__PURE__ */ traverse_(applicativeEither)(foldableArray);
var pure5 = /* @__PURE__ */ pure(applicativeEither);
var fromFoldable6 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var bind6 = /* @__PURE__ */ bind(bindEither);
var lookup7 = /* @__PURE__ */ lookup2(ordString);
var map19 = /* @__PURE__ */ map(functorEither);
var traverse5 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var append14 = /* @__PURE__ */ append(semigroupArray);
var unknownBaseError = function(name2) {
  return function(off) {
    return new DisallowedShape('{% extends "' + (name2 + ('" %} (no base template named "' + (name2 + ('" \u2014 define it with {% inline "' + (name2 + '" %} \u2026 {% endinline %} or register it as a partial)'))))), off);
  };
};
var substSuper = function(def) {
  return concatMap(function(v) {
    if (v instanceof Sep && v.value1 === "super") {
      return def;
    }
    ;
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
      return [new Block(v.value0, Section.value, "block", v.value3, v.value4)];
    }
    ;
    if (v instanceof Block) {
      return [new Block(v.value0, v.value1, v.value2, v.value3, substSuper(def)(v.value4))];
    }
    ;
    return [v];
  });
};
var strayChildShape = "a template with {% extends %} may contain only {% block %} definitions at top level (move stray content into a {% block \u2026 %} \u2026 {% endblock %})";
var nodeStart2 = function(v) {
  if (v instanceof Content) {
    return v.value0.start;
  }
  ;
  if (v instanceof Output) {
    return v.value0.start;
  }
  ;
  if (v instanceof Block) {
    return v.value0.start;
  }
  ;
  if (v instanceof RawBlock) {
    return v.value0.start;
  }
  ;
  if (v instanceof Sep) {
    return v.value0.start;
  }
  ;
  if (v instanceof NodeError) {
    return v.value0.start;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Inherit (line 172, column 13 - line 178, column 29): " + [v.constructor.name]);
};
var litName = function(args) {
  var v = head(args);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return new Just(v.value0.value0.value0);
  }
  ;
  return Nothing.value;
};
var isInlineDef = function(v) {
  if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
    var v1 = litName(v.value3);
    if (v1 instanceof Just) {
      return true;
    }
    ;
    if (v1 instanceof Nothing) {
      return false;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Inherit (line 139, column 38 - line 141, column 21): " + [v1.constructor.name]);
  }
  ;
  return false;
};
var findExtends = /* @__PURE__ */ findMap(function(v) {
  var v1 = function(v2) {
    return Nothing.value;
  };
  if (v instanceof Sep && v.value1 === "extends") {
    var $87 = litName(v.value2);
    if ($87 instanceof Just) {
      return new Just({
        name: $87.value0,
        off: v.value0.start
      });
    }
    ;
    return v1(true);
  }
  ;
  return v1(true);
});
var $lazy_collectBases = /* @__PURE__ */ $runtime_lazy4("collectBases", "Kernel.Inherit", function() {
  var step2 = function(acc) {
    return function(v) {
      var v1 = function(v2) {
        if (v instanceof Block) {
          return union6(acc)($lazy_collectBases(64)(v.value4));
        }
        ;
        return acc;
      };
      if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
        var $99 = litName(v.value3);
        if ($99 instanceof Just) {
          return insert7($99.value0)(v.value4)(union6(acc)($lazy_collectBases(63)(v.value4)));
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
  return foldl2(step2)(empty2);
});
var collectBases = /* @__PURE__ */ $lazy_collectBases(57);
var appName = function(args) {
  var v = head(args);
  if (v instanceof Just && (v.value0 instanceof App2 && v.value0.value1.length === 0)) {
    return new Just(v.value0.value0);
  }
  ;
  return Nothing.value;
};
var collectOverrides = function(nodes) {
  var validate = function(v) {
    var v1 = function(v2) {
      if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
        return new Right(unit);
      }
      ;
      if (v instanceof Sep && v.value1 === "extends") {
        return new Right(unit);
      }
      ;
      if (v instanceof Content && trim(v.value1) === "") {
        return new Right(unit);
      }
      ;
      return new Left(new DisallowedShape(strayChildShape, nodeStart2(v)));
    };
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
      var $122 = appName(v.value3);
      if ($122 instanceof Just) {
        return new Right(unit);
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
  var asBlock = function(v) {
    var v1 = function(v2) {
      return Nothing.value;
    };
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
      var $130 = appName(v.value3);
      if ($130 instanceof Just) {
        return new Just(new Tuple($130.value0, v.value4));
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
  return discard4(traverse_2(validate)(nodes))(function() {
    return pure5(fromFoldable6(mapMaybe(asBlock)(nodes)));
  });
};
var fillBlocks = function(overrides) {
  return function(nodes) {
    var fillNode = function(v) {
      var v1 = function(v2) {
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
          return new Right([new Block(v.value0, Section.value, "inline", v.value3, v.value4)]);
        }
        ;
        if (v instanceof Block) {
          return bind6(fillBlocks(overrides)(v.value4))(function(inner$prime) {
            return new Right([new Block(v.value0, v.value1, v.value2, v.value3, inner$prime)]);
          });
        }
        ;
        return new Right([v]);
      };
      if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
        var $149 = appName(v.value3);
        if ($149 instanceof Just) {
          return bind6(fillBlocks(overrides)(v.value4))(function(def) {
            var v2 = lookup7($149.value0)(overrides);
            if (v2 instanceof Nothing) {
              return new Right(def);
            }
            ;
            if (v2 instanceof Just) {
              return fillBlocks(overrides)(substSuper(def)(v2.value0));
            }
            ;
            throw new Error("Failed pattern match at Kernel.Inherit (line 117, column 11 - line 119, column 64): " + [v2.constructor.name]);
          });
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
    return map19(concat)(traverse5(fillNode)(nodes));
  };
};
var flattenWith = function(bases) {
  return function(descendant) {
    return function(nodes) {
      var v = findExtends(nodes);
      if (v instanceof Nothing) {
        return fillBlocks(descendant)(nodes);
      }
      ;
      if (v instanceof Just) {
        return bind6(collectOverrides(nodes))(function(mine) {
          return bind6(note(unknownBaseError(v.value0.name)(v.value0.off))(lookup7(v.value0.name)(bases)))(function(base) {
            return flattenWith(bases)(union6(descendant)(mine))(base);
          });
        });
      }
      ;
      throw new Error("Failed pattern match at Kernel.Inherit (line 79, column 3 - line 85, column 57): " + [v.constructor.name]);
    };
  };
};
var resolveInheritance = function(nodes) {
  var bases = collectBases(nodes);
  var v = findExtends(nodes);
  if (v instanceof Nothing) {
    return fillBlocks(empty2)(nodes);
  }
  ;
  if (v instanceof Just) {
    return bind6(flattenWith(bases)(empty2)(nodes))(function(flat) {
      return pure5(append14(filter(isInlineDef)(nodes))(flat));
    });
  }
  ;
  throw new Error("Failed pattern match at Kernel.Inherit (line 44, column 5 - line 53, column 54): " + [v.constructor.name]);
};

// output/Data.Set/index.js
var coerce3 = /* @__PURE__ */ coerce();
var foldMap4 = /* @__PURE__ */ foldMap(foldableList);
var foldl5 = /* @__PURE__ */ foldl(foldableList);
var foldr3 = /* @__PURE__ */ foldr(foldableList);
var $$Set = function(x) {
  return x;
};
var union7 = function(dictOrd) {
  return coerce3(union(dictOrd));
};
var toList = function(v) {
  return keys(v);
};
var toUnfoldable6 = function(dictUnfoldable) {
  var $96 = toUnfoldable3(dictUnfoldable);
  return function($97) {
    return $96(toList($97));
  };
};
var singleton8 = function(a) {
  return singleton4(a)(unit);
};
var member4 = function(dictOrd) {
  return coerce3(member(dictOrd));
};
var isEmpty2 = /* @__PURE__ */ coerce3(isEmpty);
var insert8 = function(dictOrd) {
  var insert12 = insert(dictOrd);
  return function(a) {
    return function(v) {
      return insert12(a)(unit)(v);
    };
  };
};
var fromMap = $$Set;
var foldableSet = {
  foldMap: function(dictMonoid) {
    var foldMap12 = foldMap4(dictMonoid);
    return function(f) {
      var $98 = foldMap12(f);
      return function($99) {
        return $98(toList($99));
      };
    };
  },
  foldl: function(f) {
    return function(x) {
      var $100 = foldl5(f)(x);
      return function($101) {
        return $100(toList($101));
      };
    };
  },
  foldr: function(f) {
    return function(x) {
      var $102 = foldr3(f)(x);
      return function($103) {
        return $102(toList($103));
      };
    };
  }
};
var eqSet = function(dictEq) {
  var eq8 = eq(eqMap(dictEq)(eqUnit));
  return {
    eq: function(v) {
      return function(v1) {
        return eq8(v)(v1);
      };
    }
  };
};
var empty3 = empty2;
var fromFoldable7 = function(dictFoldable) {
  var foldl22 = foldl(dictFoldable);
  return function(dictOrd) {
    var insert12 = insert8(dictOrd);
    return foldl22(function(m) {
      return function(a) {
        return insert12(a)(m);
      };
    })(empty3);
  };
};

// output/Data.Map/index.js
var keys2 = /* @__PURE__ */ (function() {
  var $38 = $$void(functorMap);
  return function($39) {
    return fromMap($38($39));
  };
})();

// output/Kernel.Inspect/index.js
var applicativeWriterT3 = /* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither);
var pure6 = /* @__PURE__ */ pure(applicativeWriterT3);
var map20 = /* @__PURE__ */ map(/* @__PURE__ */ functorWriterT(functorEither));
var member5 = /* @__PURE__ */ member(ordString);
var traverse6 = /* @__PURE__ */ traverse(traversableArray)(applicativeWriterT3);
var elem8 = /* @__PURE__ */ elem(foldableArray)(eqString);
var fromFoldable8 = /* @__PURE__ */ fromFoldable(foldableSet);
var bindWriterT3 = /* @__PURE__ */ bindWriterT(semigroupArray)(bindEither);
var bind7 = /* @__PURE__ */ bind(bindWriterT3);
var discard5 = /* @__PURE__ */ discard(discardUnit)(bindWriterT3);
var when3 = /* @__PURE__ */ when(applicativeWriterT3);
var tell3 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var monadThrowWriterT3 = /* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither);
var preludeEnv3 = /* @__PURE__ */ preludeEnv(monadThrowWriterT3);
var runTemplate3 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
var knownScoped = ["this", "index", "index0", "index1", "rindex0", "rindex1", "length", "depth", "key", "first", "last", "parent", "root", "loop", "@parentchain"];
var dummyCtl = function(env) {
  return {
    env,
    children: [],
    span: {
      start: 0,
      end: 0
    },
    render: function(v) {
      return function(v1) {
        return pure6("");
      };
    },
    "eval": function(v) {
      return function(v1) {
        return pure6(VNull.value);
      };
    },
    clause: function(v) {
      return {
        before: [],
        body: Nothing.value
      };
    },
    hash: Nothing.value,
    blockParams: [],
    loopLabel: Nothing.value
  };
};
var resolveOpt = function(name2) {
  return function(env) {
    var v = lookupOperation(name2)(env);
    if (v instanceof Nothing) {
      return pure6(Nothing.value);
    }
    ;
    if (v instanceof Just) {
      return map20(Just.create)(v.value0(dummyCtl(env))([]));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Inspect (line 106, column 23 - line 108, column 43): " + [v.constructor.name]);
  };
};
var resolveValue = function(name2) {
  return function(env) {
    return maybe(pure6(VNull.value))(function(op) {
      return op(dummyCtl(env))([]);
    })(lookupOperation(name2)(env));
  };
};
var resolveLocals = function(env) {
  var frame = innermostFrame(env);
  var $43 = !member5("@parentchain")(frame);
  if ($43) {
    return pure6([]);
  }
  ;
  return traverse6(function(name2) {
    return map20(Tuple.create(name2))(resolveValue(name2)(env));
  })(filter(function(k) {
    return !elem8(k)(knownScoped);
  })(fromFoldable8(keys2(frame))));
};
var snapshot = function(env) {
  return bind7(resolveOpt("parent")(env))(function(parent) {
    return bind7(resolveOpt("root")(env))(function(root) {
      return bind7(resolveOpt("index0")(env))(function(index3) {
        return bind7(resolveOpt("index1")(env))(function(index1) {
          return bind7(resolveOpt("key")(env))(function(key) {
            return bind7(resolveOpt("first")(env))(function(first) {
              return bind7(resolveOpt("last")(env))(function(last3) {
                return bind7(resolveLocals(env))(function(locals) {
                  return pure6({
                    "this": refContext(env),
                    parent,
                    root,
                    index: index3,
                    index1,
                    key,
                    first,
                    last: last3,
                    locals
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};
var inspectEmit = function(target) {
  return function(env) {
    return function(span2) {
      return function(produce) {
        return bind7(produce)(function(s) {
          return discard5(when3(span2.start === target.start && (span2.end === target.end && refCurrentFile(env) === target.file))(bind7(snapshot(env))(function(snap) {
            return tell3([snap]);
          })))(function() {
            return pure6(s);
          });
        });
      };
    };
  };
};
var inspectUsing = function(toEngine) {
  return function(setup) {
    return function(target) {
      return function(nodes) {
        return function(dat) {
          var engine = (function() {
            var v2 = toEngine(setup(preludeEnv3(dat)));
            return {
              blockArgs: v2.blockArgs,
              initial: v2.initial,
              recordText: v2.recordText,
              resolve: v2.resolve,
              resolveStrict: v2.resolveStrict,
              stringify: v2.stringify,
              recordEmit: inspectEmit(target)
            };
          })();
          var v = runWriterT(runTemplate3(engine)(nodes));
          if (v instanceof Left) {
            return new Left(v.value0);
          }
          ;
          if (v instanceof Right) {
            return new Right(v.value0.value1);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Inspect (line 77, column 5 - line 79, column 43): " + [v.constructor.name]);
        };
      };
    };
  };
};
var inspectResolvedLenient = /* @__PURE__ */ inspectUsing(/* @__PURE__ */ refEngineWith(monadThrowWriterT3)(/* @__PURE__ */ lenientResolve(monadThrowWriterT3)));
var inspectResolvedStrict = /* @__PURE__ */ inspectUsing(/* @__PURE__ */ refEngine(monadThrowWriterT3));

// output/Kernel.Lower/index.js
var RText = /* @__PURE__ */ (function() {
  function RText2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RText2.create = function(value0) {
    return function(value1) {
      return new RText2(value0, value1);
    };
  };
  return RText2;
})();
var ROut = /* @__PURE__ */ (function() {
  function ROut2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  ROut2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new ROut2(value0, value1, value2);
      };
    };
  };
  return ROut2;
})();
var RIf = /* @__PURE__ */ (function() {
  function RIf2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RIf2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RIf2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RIf2;
})();
var RUnless = /* @__PURE__ */ (function() {
  function RUnless2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RUnless2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RUnless2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RUnless2;
})();
var REach = /* @__PURE__ */ (function() {
  function REach2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  REach2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new REach2(value0, value1, value2, value3);
        };
      };
    };
  };
  return REach2;
})();
var RWith = /* @__PURE__ */ (function() {
  function RWith2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RWith2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RWith2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RWith2;
})();
var RCall = /* @__PURE__ */ (function() {
  function RCall2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RCall2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RCall2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RCall2;
})();
var RSep2 = /* @__PURE__ */ (function() {
  function RSep5(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RSep5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RSep5(value0, value1, value2);
      };
    };
  };
  return RSep5;
})();
var RRaw2 = /* @__PURE__ */ (function() {
  function RRaw5(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RRaw5.create = function(value0) {
    return function(value1) {
      return new RRaw5(value0, value1);
    };
  };
  return RRaw5;
})();
var lower = /* @__PURE__ */ (function() {
  var lowerIf = function(span2) {
    return function(cond) {
      return function(children) {
        return function(recurse) {
          var foldClauses = function(cs) {
            var v2 = uncons(cs);
            if (v2 instanceof Nothing) {
              return [];
            }
            ;
            if (v2 instanceof Just) {
              if (v2.value0.head.name === "elif" && v2.value0.head.args.length === 1) {
                return [new RIf(v2.value0.head.span, v2["value0"]["head"]["args"][0], recurse(v2.value0.head.body), foldClauses(v2.value0.tail))];
              }
              ;
              return recurse(v2.value0.head.body);
            }
            ;
            throw new Error("Failed pattern match at Kernel.Lower (line 115, column 22 - line 119, column 32): " + [v2.constructor.name]);
          };
          var v = splitClauses(children);
          return new RIf(span2, cond, recurse(v.before), foldClauses(v.clauses));
        };
      };
    };
  };
  var lowerBlock = function(span2) {
    return function(name2) {
      return function(args) {
        return function(children) {
          return function(recurse) {
            var s = splitClause("else")(children);
            var elseBranch = recurse(fromMaybe([])(s.clause));
            var before = recurse(s.before);
            var v = head(args);
            if (v instanceof Just && name2 === "if") {
              return lowerIf(span2)(v.value0)(children)(recurse);
            }
            ;
            if (v instanceof Just) {
              if (name2 === "unless") {
                return new RUnless(span2, v.value0, before, elseBranch);
              }
              ;
              if (name2 === "each") {
                return new REach(span2, v.value0, before, elseBranch);
              }
              ;
              if (name2 === "with") {
                return new RWith(span2, v.value0, before, elseBranch);
              }
              ;
            }
            ;
            return new RCall(span2, name2, args, recurse(children));
          };
        };
      };
    };
  };
  var escaping = function(v) {
    if (v instanceof App2 && (v.value0 === "escapeHtml" && v.value1.length === 1)) {
      return new Tuple(true, v["value1"][0]);
    }
    ;
    return new Tuple(false, v);
  };
  return foldTemplate({
    content: function(sp) {
      return function(s) {
        return [new RText(sp, s)];
      };
    },
    output: function(sp) {
      return function(e) {
        return [uncurry(ROut.create(sp))(escaping(e))];
      };
    },
    raw: function(sp) {
      return function(v) {
        return function(v1) {
          return function(body) {
            return [new RRaw2(sp, body)];
          };
        };
      };
    },
    sep: function(sp) {
      return function(name2) {
        return function(args) {
          return [new RSep2(sp, name2, args)];
        };
      };
    },
    block: function(b) {
      return [lowerBlock(b.span)(b.name)(b.args)(b.children)(b.recurse)];
    },
    nodeError: function(v) {
      return function(v1) {
        return [];
      };
    },
    concat: join(bindArray)
  });
})();

// output/Kernel.Provenance/index.js
var applicativeWriterT4 = /* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither);
var pure7 = /* @__PURE__ */ pure(applicativeWriterT4);
var tell4 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var bindWriterT4 = /* @__PURE__ */ bindWriterT(semigroupArray)(bindEither);
var bind8 = /* @__PURE__ */ bind(bindWriterT4);
var listen2 = /* @__PURE__ */ listen(/* @__PURE__ */ monadWriterWriterT(monoidArray)(monadEither));
var discard6 = /* @__PURE__ */ discard(discardUnit)(bindWriterT4);
var when4 = /* @__PURE__ */ when(applicativeWriterT4);
var map21 = /* @__PURE__ */ map(functorArray);
var map110 = /* @__PURE__ */ map(functorMaybe);
var mapAccumL2 = /* @__PURE__ */ mapAccumL(traversableArray);
var monadThrowWriterT4 = /* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither);
var preludeEnv4 = /* @__PURE__ */ preludeEnv(monadThrowWriterT4);
var runTemplate4 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
var recordTextProv = function(env) {
  return function(span2) {
    return function(text) {
      if (text === "") {
        return pure7(unit);
      }
      ;
      if (otherwise) {
        return tell4([{
          isEmit: false,
          file: refCurrentFile(env),
          span: new Just(span2),
          text
        }]);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Provenance (line 98, column 1 - line 98, column 61): " + [env.constructor.name, span2.constructor.name, text.constructor.name]);
    };
  };
};
var recordEmitProv = function(env) {
  return function(span2) {
    return function(produce) {
      return bind8(listen2(produce))(function(v) {
        return discard6(when4(v.value0 !== "" && $$null(v.value1))(tell4([{
          isEmit: true,
          file: refCurrentFile(env),
          span: new Just(span2),
          text: v.value0
        }])))(function() {
          return pure7(v.value0);
        });
      });
    };
  };
};
var assemble = function(output) {
  return function(raws) {
    if (joinWith("")(map21(function(v) {
      return v.text;
    })(raws)) !== output) {
      return [];
    }
    ;
    if (otherwise) {
      var step2 = function(at) {
        return function(r) {
          return {
            accum: at + length2(r.text) | 0,
            value: {
              out: at,
              len: length2(r.text),
              kind: (function() {
                if (r.isEmit) {
                  return "emit";
                }
                ;
                return "text";
              })(),
              file: r.file,
              start: map110(function(v) {
                return v.start;
              })(r.span),
              end: map110(function(v) {
                return v.end;
              })(r.span)
            }
          };
        };
      };
      return mapAccumL2(step2)(0)(raws).value;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Provenance (line 116, column 1 - line 116, column 52): " + [output.constructor.name, raws.constructor.name]);
  };
};
var runMappedUsing = function(toEngine) {
  return function(setup) {
    return function(nodes) {
      return function(dat) {
        var engine = (function() {
          var v2 = toEngine(setup(preludeEnv4(dat)));
          return {
            blockArgs: v2.blockArgs,
            initial: v2.initial,
            resolve: v2.resolve,
            resolveStrict: v2.resolveStrict,
            stringify: v2.stringify,
            recordText: recordTextProv,
            recordEmit: recordEmitProv
          };
        })();
        var v = runWriterT(runTemplate4(engine)(nodes));
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          return new Right({
            output: v.value0.value0,
            segments: assemble(v.value0.value0)(v.value0.value1)
          });
        }
        ;
        throw new Error("Failed pattern match at Kernel.Provenance (line 91, column 5 - line 93, column 84): " + [v.constructor.name]);
      };
    };
  };
};
var runResolvedLenientMapped = /* @__PURE__ */ runMappedUsing(/* @__PURE__ */ refEngineWith(monadThrowWriterT4)(/* @__PURE__ */ lenientResolve(monadThrowWriterT4)));
var runResolvedMapped = /* @__PURE__ */ runMappedUsing(/* @__PURE__ */ refEngine(monadThrowWriterT4));

// output/Kernel.SetSugar/index.js
var show9 = /* @__PURE__ */ show(showInt);
var append15 = /* @__PURE__ */ append(semigroupArray);
var elem9 = /* @__PURE__ */ elem2(eqString);
var captureName = function(args) {
  var v = head(args);
  if (v instanceof Just && (v.value0 instanceof App2 && v.value0.value1.length === 0)) {
    return new Just(v.value0.value0);
  }
  ;
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return new Just(v.value0.value0.value0);
  }
  ;
  return Nothing.value;
};
var liftSet = function(nodes) {
  var v = uncons(nodes);
  if (v instanceof Nothing) {
    return [];
  }
  ;
  if (v instanceof Just) {
    if (v.value0.head instanceof Sep && v.value0.head.value1 === "set") {
      return [new Block(v.value0.head.value0, Section.value, "local", v.value0.head.value2, liftSet(v.value0.tail))];
    }
    ;
    var v1 = function(v2) {
      if (v.value0.head instanceof Block) {
        return cons(new Block(v.value0.head.value0, v.value0.head.value1, v.value0.head.value2, v.value0.head.value3, liftSet(v.value0.head.value4)))(liftSet(v.value0.tail));
      }
      ;
      return cons(v.value0.head)(liftSet(v.value0.tail));
    };
    if (v.value0.head instanceof Block && (v.value0.head.value1 instanceof Section && v.value0.head.value2 === "capture")) {
      var $37 = captureName(v.value0.head.value3);
      if ($37 instanceof Just) {
        var capName = "@cap$" + show9(v.value0.head.value0.start);
        return [new Block(v.value0.head.value0, Section.value, "inline", [new Lit(new VString(capName))], liftSet(v.value0.head.value4)), new Block(v.value0.head.value0, Section.value, "local", [new App2($37.value0 + "=", []), new App2("partial", [new Lit(new VString(capName))])], liftSet(v.value0.tail))];
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  }
  ;
  throw new Error("Failed pattern match at Kernel.SetSugar (line 39, column 17 - line 66, column 38): " + [v.constructor.name]);
};
var reservedBindingViolation = function(blockHeads) {
  return function(nodes) {
    var shapeFor = function(k) {
      return "{% set/local " + (k + (" = \u2026 %} (`" + (k + "` is a reserved name \u2014 a binding may not shadow a scope root (this/root/parent/outer/loop/yield) or a block head)")));
    };
    var scopeRoots = ["this", "root", "parent", "outer", "loop", "yield"];
    var reserved2 = append15(scopeRoots)(blockHeads);
    var captureReserved = function(args) {
      var v = captureName(args);
      if (v instanceof Just && elem9(v.value0)(reserved2)) {
        return new Just(v.value0);
      }
      ;
      return Nothing.value;
    };
    var bindingKey = function(v) {
      if (v instanceof App2 && (v.value1.length === 0 && contains("=")(v.value0))) {
        return new Just(takeWhile2(function(v12) {
          return v12 !== "=";
        })(v.value0));
      }
      ;
      if (v instanceof App2 && v.value0 === "bind") {
        var v1 = head(v.value1);
        if (v1 instanceof Just && (v1.value0 instanceof Lit && v1.value0.value0 instanceof VString)) {
          return new Just(v1.value0.value0.value0);
        }
        ;
        return Nothing.value;
      }
      ;
      return Nothing.value;
    };
    var firstReserved = function(args) {
      return find2(function(k) {
        return elem9(k)(reserved2);
      })(mapMaybe(bindingKey)(args));
    };
    var node2 = function(v) {
      var v1 = function(v2) {
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "local")) {
          var v3 = firstReserved(v.value3);
          if (v3 instanceof Just) {
            return new Just({
              off: v.value0.start,
              shape: shapeFor(v3.value0)
            });
          }
          ;
          if (v3 instanceof Nothing) {
            return reservedBindingViolation(blockHeads)(v.value4);
          }
          ;
          throw new Error("Failed pattern match at Kernel.SetSugar (line 93, column 43 - line 95, column 58): " + [v3.constructor.name]);
        }
        ;
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "capture")) {
          var v3 = captureReserved(v.value3);
          if (v3 instanceof Just) {
            return new Just({
              off: v.value0.start,
              shape: shapeFor(v3.value0)
            });
          }
          ;
          if (v3 instanceof Nothing) {
            return reservedBindingViolation(blockHeads)(v.value4);
          }
          ;
          throw new Error("Failed pattern match at Kernel.SetSugar (line 98, column 45 - line 100, column 58): " + [v3.constructor.name]);
        }
        ;
        if (v instanceof Block) {
          return reservedBindingViolation(blockHeads)(v.value4);
        }
        ;
        return Nothing.value;
      };
      if (v instanceof Sep && v.value1 === "set") {
        var $79 = firstReserved(v.value2);
        if ($79 instanceof Just) {
          return new Just({
            off: v.value0.start,
            shape: shapeFor($79.value0)
          });
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
    return head(mapMaybe(node2)(nodes));
  };
};

// output/ClassicBars/index.js
var elem10 = /* @__PURE__ */ elem(foldableArray)(eqString);
var show10 = /* @__PURE__ */ show(showInt);
var nub3 = /* @__PURE__ */ nub(ordString);
var map24 = /* @__PURE__ */ map(functorArray);
var pure8 = /* @__PURE__ */ pure(applicativeEither);
var lmap2 = /* @__PURE__ */ lmap(bifunctorEither);
var runResolvedLenient2 = /* @__PURE__ */ runResolvedLenient(monadThrowEither);
var show13 = /* @__PURE__ */ show(/* @__PURE__ */ showNonEmptyArray(showParseError));
var traverse7 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable9 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var union8 = /* @__PURE__ */ union(ordString);
var show23 = /* @__PURE__ */ show(showError);
var map111 = /* @__PURE__ */ map(functorMap);
var identity10 = /* @__PURE__ */ identity(categoryFn);
var monadThrowWriterT5 = /* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither);
var refEngineWith2 = /* @__PURE__ */ refEngineWith(monadThrowWriterT5);
var lenientResolve2 = /* @__PURE__ */ lenientResolve(monadThrowWriterT5);
var surfaceParseOf = function(opts) {
  return {
    parse: parseWith(opts),
    statementTags: false,
    partialBlocks: opts.partialBlocks
  };
};
var surfaceClauses = ["else", "elif", "when"];
var i18nOpNames = ["t", "number", "date", "selectPlural", "relative"];
var i18nNote = function(template) {
  var used = filter(function(r) {
    return elem10(r.name)(i18nOpNames);
  })(operationRefs(template));
  var $94 = $$null(used);
  if ($94) {
    return "";
  }
  ;
  return "\n\n## \u2139 Localization (ADR-029)\n" + ("This template calls " + (show10(length(used)) + (" i18n operation(s) (" + (joinWith(", ")(nub3(map24(function(v) {
    return v.name;
  })(used))) + ") \u2014 analysed with **no translator wired**, so each rendered its key/value unchanged. Register a host translator (`registerTranslator`, or `withTranslator` in PureScript) or they ship untranslated."))));
};
var desugarSurfaceWith = function(lv) {
  return desugarWith(lv)(surfaceClauses);
};
var desugarSurface = /* @__PURE__ */ desugar(surfaceClauses);
var desugarStmt = function(statementTags) {
  return function(lv) {
    return function(nodes) {
      return desugarSurfaceWith(lv)((function() {
        if (statementTags) {
          return renameSurfaceHeads(liftSet(nodes));
        }
        ;
        return nodes;
      })());
    };
  };
};
var checkSurfaceStrict = function(strict) {
  return function(nodes) {
    var violation = (function() {
      if (strict) {
        return strictSurfaceViolation(nodes);
      }
      ;
      if (otherwise) {
        var v = maxbarsEachAsViolation(nodes);
        if (v instanceof Just) {
          return new Just(v.value0);
        }
        ;
        if (v instanceof Nothing) {
          var v1 = retiredLetViolation(nodes);
          if (v1 instanceof Just) {
            return new Just(v1.value0);
          }
          ;
          if (v1 instanceof Nothing) {
            var v2 = elseIfViolation(nodes);
            if (v2 instanceof Just) {
              return new Just(v2.value0);
            }
            ;
            if (v2 instanceof Nothing) {
              return caseLeadingViolation(nodes);
            }
            ;
            throw new Error("Failed pattern match at ClassicBars (line 150, column 22 - line 152, column 50): " + [v2.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at ClassicBars (line 148, column 20 - line 152, column 50): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars (line 146, column 19 - line 152, column 50): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars (line 144, column 3 - line 152, column 50): ");
    })();
    if (violation instanceof Just) {
      return new Left(new DisallowedShape(violation.value0.shape, violation.value0.off));
    }
    ;
    if (violation instanceof Nothing) {
      return pure8(unit);
    }
    ;
    throw new Error("Failed pattern match at ClassicBars (line 140, column 35 - line 142, column 23): " + [violation.constructor.name]);
  };
};
var renderSurfaceI18n = function(tr) {
  return function(src) {
    return function(dat) {
      var v = parse(src);
      if (v instanceof Left) {
        return new Left(renderParseErrorsAt(src)(v.value0));
      }
      ;
      var v1 = function(v2) {
        if (v instanceof Right) {
          var v3 = hoistInline(desugarSurface(v.value0.nodes));
          var v4 = runResolvedLenient2(v.value0.directives)((function() {
            var $303 = withTranslator(tr);
            var $304 = registerPartials(v3.partials);
            return function($305) {
              return $303($304($305));
            };
          })())(v3.template)(dat);
          if (v4 instanceof Left) {
            return new Left(formatError(src)(v4.value0));
          }
          ;
          if (v4 instanceof Right) {
            return new Right(v4.value0);
          }
          ;
          throw new Error("Failed pattern match at ClassicBars (line 455, column 7 - line 459, column 31): " + [v4.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars (line 447, column 1 - line 447, column 75): " + [v.constructor.name]);
      };
      if (v instanceof Right) {
        var $123 = checkSurfaceStrict(true)(v.value0.nodes);
        if ($123 instanceof Left) {
          return new Left(renderParseErrorAt(src)($123.value0));
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
};
var renderSurfaceWith = function(partialSrcs) {
  return function(src) {
    return function(dat) {
      var compilePartial = function(v3) {
        var v12 = parse(v3.value1);
        if (v12 instanceof Left) {
          return new Left(show13(v12.value0));
        }
        ;
        if (v12 instanceof Right) {
          return new Right({
            name: v3.value0,
            template: desugarSurface(v12.value0.nodes)
          });
        }
        ;
        throw new Error("Failed pattern match at ClassicBars (line 212, column 35 - line 214, column 70): " + [v12.constructor.name]);
      };
      var v = traverse7(compilePartial)(partialSrcs);
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        var v1 = parse(src);
        if (v1 instanceof Left) {
          return new Left(show13(v1.value0));
        }
        ;
        var v2 = function(v3) {
          if (v1 instanceof Right) {
            var v4 = hoistInline(desugarSurface(v1.value0.nodes));
            var externalT = fromFoldable9(map24(function(p) {
              return new Tuple(p.name, p.template);
            })(v.value0));
            var setup = registerPartials(union8(v4.partials)(externalT));
            var v5 = runResolvedLenient2(v1.value0.directives)(setup)(v4.template)(dat);
            if (v5 instanceof Left) {
              return new Left(show23(v5.value0));
            }
            ;
            if (v5 instanceof Right) {
              return new Right(v5.value0);
            }
            ;
            throw new Error("Failed pattern match at ClassicBars (line 206, column 11 - line 208, column 35): " + [v5.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at ClassicBars (line 193, column 1 - line 193, column 92): " + [v1.constructor.name]);
        };
        if (v1 instanceof Right) {
          var $149 = checkSurfaceStrict(true)(v1.value0.nodes);
          if ($149 instanceof Left) {
            return new Left(renderParseErrorAt(src)($149.value0));
          }
          ;
          return v2(true);
        }
        ;
        return v2(true);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars (line 195, column 3 - line 208, column 35): " + [v.constructor.name]);
    };
  };
};
var checkBraceControl = function(src) {
  return function(nodes) {
    var v = braceControlViolation(surfaceClauses)(src)(nodes);
    if (v instanceof Just) {
      return new Left(new DisallowedShape(v.value0.shape, v.value0.off));
    }
    ;
    if (v instanceof Nothing) {
      var v1 = reservedBindingViolation(blockHelperNames)(nodes);
      if (v1 instanceof Just) {
        return new Left(new DisallowedShape(v1.value0.shape, v1.value0.off));
      }
      ;
      if (v1 instanceof Nothing) {
        var v2 = withReRootViolation(nodes);
        if (v2 instanceof Just) {
          return new Left(new DisallowedShape(v2.value0.shape, v2.value0.off));
        }
        ;
        if (v2 instanceof Nothing) {
          var v3 = eachLoopViolation(nodes);
          if (v3 instanceof Just) {
            return new Left(new DisallowedShape(v3.value0.shape, v3.value0.off));
          }
          ;
          if (v3 instanceof Nothing) {
            return pure8(unit);
          }
          ;
          throw new Error("Failed pattern match at ClassicBars (line 172, column 18 - line 174, column 29): " + [v3.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars (line 170, column 16 - line 174, column 29): " + [v2.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars (line 165, column 14 - line 174, column 29): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at ClassicBars (line 161, column 31 - line 174, column 29): " + [v.constructor.name]);
  };
};
var inspectSurfaceDiagWith = function(strict) {
  return function(lv) {
    return function(sp) {
      return function(truthy) {
        return function(target) {
          return function(partialSrcs) {
            return function(src) {
              return function(dat) {
                var compilePartial = function(v3) {
                  var v12 = sp.parse(v3.value1);
                  if (v12 instanceof Left) {
                    return new Left(renderParseErrorsAt(v3.value1)(v12.value0));
                  }
                  ;
                  if (v12 instanceof Right) {
                    return new Right({
                      name: v3.value0,
                      template: desugarStmt(sp.statementTags)(lv)(v12.value0.nodes)
                    });
                  }
                  ;
                  throw new Error("Failed pattern match at ClassicBars (line 326, column 35 - line 328, column 87): " + [v12.constructor.name]);
                };
                var v = traverse7(compilePartial)(partialSrcs);
                if (v instanceof Left) {
                  return new Left(v.value0);
                }
                ;
                if (v instanceof Right) {
                  var v1 = sp.parse(src);
                  if (v1 instanceof Left) {
                    return new Left(renderParseErrorsAt(src)(v1.value0));
                  }
                  ;
                  var v2 = function(v3) {
                    var v4 = function(v5) {
                      if (v1 instanceof Right) {
                        var v6 = hoistInline(desugarStmt(sp.statementTags)(lv)(v1.value0.nodes));
                        var partialFiles = union8(map111($$const("main"))(v6.partials))(fromFoldable9(map24(function(p) {
                          return new Tuple(p.name, p.name);
                        })(v.value0)));
                        var externalT = fromFoldable9(map24(function(p) {
                          return new Tuple(p.name, p.template);
                        })(v.value0));
                        var setup = (function() {
                          var $306 = registerPartialFiles(partialFiles);
                          var $307 = withTruthy(truthy);
                          var $308 = withYieldName((function() {
                            if (sp.partialBlocks) {
                              return "partial-block";
                            }
                            ;
                            return "yield";
                          })());
                          var $309 = registerPartials(union8(v6.partials)(externalT));
                          return function($310) {
                            return $306($307($308($309($310))));
                          };
                        })();
                        return lmap2(formatError(src))(inspectResolvedLenient(setup)(target)(v6.template)(dat));
                      }
                      ;
                      throw new Error("Failed pattern match at ClassicBars (line 293, column 1 - line 302, column 36): " + [v1.constructor.name]);
                    };
                    if (v1 instanceof Right) {
                      if (sp.statementTags) {
                        var $182 = checkBraceControl(src)(v1.value0.nodes);
                        if ($182 instanceof Left) {
                          return new Left(renderParseErrorAt(src)($182.value0));
                        }
                        ;
                        return v4(true);
                      }
                      ;
                      return v4(true);
                    }
                    ;
                    return v4(true);
                  };
                  if (v1 instanceof Right) {
                    var $187 = checkSurfaceStrict(strict)(v1.value0.nodes);
                    if ($187 instanceof Left) {
                      return new Left(renderParseErrorAt(src)($187.value0));
                    }
                    ;
                    return v2(true);
                  }
                  ;
                  return v2(true);
                }
                ;
                throw new Error("Failed pattern match at ClassicBars (line 304, column 3 - line 324, column 84): " + [v.constructor.name]);
              };
            };
          };
        };
      };
    };
  };
};
var inspectSurfaceWith = /* @__PURE__ */ inspectSurfaceDiagWith(true)(noLoopVars)(/* @__PURE__ */ surfaceParseOf(defaultParseOptions))(handlebars);
var renderSurfaceDiagWith = function(strict) {
  return function(lv) {
    return function(sp) {
      return function(truthy) {
        return function(src) {
          return function(dat) {
            var v = sp.parse(src);
            if (v instanceof Left) {
              return new Left(renderParseErrorsAt(src)(v.value0));
            }
            ;
            var v1 = function(v2) {
              var v3 = function(v4) {
                var v5 = function(v6) {
                  if (v instanceof Right) {
                    var inherited = (function() {
                      if (sp.statementTags) {
                        return either($$const(v.value0.nodes))(identity10)(resolveInheritance(v.value0.nodes));
                      }
                      ;
                      return v.value0.nodes;
                    })();
                    var v7 = hoistInline(desugarStmt(sp.statementTags)(lv)(inherited));
                    var v8 = runResolvedLenient2(v.value0.directives)((function() {
                      var $311 = withTruthy(truthy);
                      var $312 = withYieldName((function() {
                        if (sp.partialBlocks) {
                          return "partial-block";
                        }
                        ;
                        return "yield";
                      })());
                      var $313 = registerPartials(v7.partials);
                      return function($314) {
                        return $311($312($313($314)));
                      };
                    })())(v7.template)(dat);
                    if (v8 instanceof Left) {
                      return new Left(formatError(src)(v8.value0));
                    }
                    ;
                    if (v8 instanceof Right) {
                      return new Right(v8.value0);
                    }
                    ;
                    throw new Error("Failed pattern match at ClassicBars (line 424, column 7 - line 434, column 31): " + [v8.constructor.name]);
                  }
                  ;
                  throw new Error("Failed pattern match at ClassicBars (line 403, column 1 - line 404, column 94): " + [v.constructor.name]);
                };
                if (v instanceof Right) {
                  if (sp.statementTags) {
                    var $208 = resolveInheritance(v.value0.nodes);
                    if ($208 instanceof Left) {
                      return new Left(renderParseErrorAt(src)($208.value0));
                    }
                    ;
                    return v5(true);
                  }
                  ;
                  return v5(true);
                }
                ;
                return v5(true);
              };
              if (v instanceof Right) {
                if (sp.statementTags) {
                  var $214 = checkBraceControl(src)(v.value0.nodes);
                  if ($214 instanceof Left) {
                    return new Left(renderParseErrorAt(src)($214.value0));
                  }
                  ;
                  return v3(true);
                }
                ;
                return v3(true);
              }
              ;
              return v3(true);
            };
            if (v instanceof Right) {
              var $219 = checkSurfaceStrict(strict)(v.value0.nodes);
              if ($219 instanceof Left) {
                return new Left(renderParseErrorAt(src)($219.value0));
              }
              ;
              return v1(true);
            }
            ;
            return v1(true);
          };
        };
      };
    };
  };
};
var renderSurfaceDiag = /* @__PURE__ */ renderSurfaceDiagWith(true)(noLoopVars)(/* @__PURE__ */ surfaceParseOf(defaultParseOptions))(handlebars);
var renderSurfaceMappedDiagWith = function(strict) {
  return function(lv) {
    return function(sp) {
      return function(truthy) {
        return function(partialSrcs) {
          return function(src) {
            return function(dat) {
              var compilePartial = function(v3) {
                var v12 = sp.parse(v3.value1);
                if (v12 instanceof Left) {
                  return new Left(renderParseErrorsAt(v3.value1)(v12.value0));
                }
                ;
                if (v12 instanceof Right) {
                  return new Right({
                    name: v3.value0,
                    template: desugarStmt(sp.statementTags)(lv)(v12.value0.nodes)
                  });
                }
                ;
                throw new Error("Failed pattern match at ClassicBars (line 273, column 35 - line 275, column 87): " + [v12.constructor.name]);
              };
              var v = traverse7(compilePartial)(partialSrcs);
              if (v instanceof Left) {
                return new Left(v.value0);
              }
              ;
              if (v instanceof Right) {
                var v1 = sp.parse(src);
                if (v1 instanceof Left) {
                  return new Left(renderParseErrorsAt(src)(v1.value0));
                }
                ;
                var v2 = function(v3) {
                  var v4 = function(v5) {
                    if (v1 instanceof Right) {
                      var v6 = hoistInline(desugarStmt(sp.statementTags)(lv)(v1.value0.nodes));
                      var partialFiles = union8(map111($$const("main"))(v6.partials))(fromFoldable9(map24(function(p) {
                        return new Tuple(p.name, p.name);
                      })(v.value0)));
                      var externalT = fromFoldable9(map24(function(p) {
                        return new Tuple(p.name, p.template);
                      })(v.value0));
                      var setup = (function() {
                        var $317 = registerPartialFiles(partialFiles);
                        var $318 = withTruthy(truthy);
                        var $319 = withYieldName((function() {
                          if (sp.partialBlocks) {
                            return "partial-block";
                          }
                          ;
                          return "yield";
                        })());
                        var $320 = registerPartials(union8(v6.partials)(externalT));
                        return function($321) {
                          return $317($318($319($320($321))));
                        };
                      })();
                      return lmap2(formatError(src))(runResolvedLenientMapped(setup)(v6.template)(dat));
                    }
                    ;
                    throw new Error("Failed pattern match at ClassicBars (line 239, column 1 - line 247, column 67): " + [v1.constructor.name]);
                  };
                  if (v1 instanceof Right) {
                    if (sp.statementTags) {
                      var $243 = checkBraceControl(src)(v1.value0.nodes);
                      if ($243 instanceof Left) {
                        return new Left(renderParseErrorAt(src)($243.value0));
                      }
                      ;
                      return v4(true);
                    }
                    ;
                    return v4(true);
                  }
                  ;
                  return v4(true);
                };
                if (v1 instanceof Right) {
                  var $248 = checkSurfaceStrict(strict)(v1.value0.nodes);
                  if ($248 instanceof Left) {
                    return new Left(renderParseErrorAt(src)($248.value0));
                  }
                  ;
                  return v2(true);
                }
                ;
                return v2(true);
              }
              ;
              throw new Error("Failed pattern match at ClassicBars (line 249, column 3 - line 271, column 79): " + [v.constructor.name]);
            };
          };
        };
      };
    };
  };
};
var renderSurfaceMappedWith = /* @__PURE__ */ renderSurfaceMappedDiagWith(true)(noLoopVars)(/* @__PURE__ */ surfaceParseOf(defaultParseOptions))(handlebars);
var renderSurfaceMapped = /* @__PURE__ */ renderSurfaceMappedWith([]);
var renderSurfaceWithHelpersWith = function(strict) {
  return function(lv) {
    return function(sp) {
      return function(truthy) {
        return function(helpers) {
          return function(partialSrcs) {
            return function(src) {
              return function(dat) {
                var compilePartial = function(v3) {
                  var v12 = sp.parse(v3.value1);
                  if (v12 instanceof Left) {
                    return new Left(renderParseErrorsAt(v3.value1)(v12.value0));
                  }
                  ;
                  if (v12 instanceof Right) {
                    return new Right({
                      name: v3.value0,
                      template: desugarStmt(sp.statementTags)(lv)(v12.value0.nodes)
                    });
                  }
                  ;
                  throw new Error("Failed pattern match at ClassicBars (line 389, column 35 - line 391, column 87): " + [v12.constructor.name]);
                };
                var v = traverse7(compilePartial)(partialSrcs);
                if (v instanceof Left) {
                  return new Left(v.value0);
                }
                ;
                if (v instanceof Right) {
                  var v1 = sp.parse(src);
                  if (v1 instanceof Left) {
                    return new Left(renderParseErrorsAt(src)(v1.value0));
                  }
                  ;
                  var v2 = function(v3) {
                    var v4 = function(v5) {
                      if (v1 instanceof Right) {
                        var v6 = hoistInline(desugarStmt(sp.statementTags)(lv)(v1.value0.nodes));
                        var externalT = fromFoldable9(map24(function(p) {
                          return new Tuple(p.name, p.template);
                        })(v.value0));
                        var setup = (function() {
                          var $322 = withTruthy(truthy);
                          var $323 = withYieldName((function() {
                            if (sp.partialBlocks) {
                              return "partial-block";
                            }
                            ;
                            return "yield";
                          })());
                          var $324 = registerAll(helpers);
                          var $325 = registerPartials(union8(v6.partials)(externalT));
                          return function($326) {
                            return $322($323($324($325($326))));
                          };
                        })();
                        var v7 = runResolvedLenient2(v1.value0.directives)(setup)(v6.template)(dat);
                        if (v7 instanceof Left) {
                          return new Left(formatError(src)(v7.value0));
                        }
                        ;
                        if (v7 instanceof Right) {
                          return new Right(v7.value0);
                        }
                        ;
                        throw new Error("Failed pattern match at ClassicBars (line 383, column 11 - line 385, column 35): " + [v7.constructor.name]);
                      }
                      ;
                      throw new Error("Failed pattern match at ClassicBars (line 351, column 1 - line 360, column 26): " + [v1.constructor.name]);
                    };
                    if (v1 instanceof Right) {
                      if (sp.statementTags) {
                        var $277 = checkBraceControl(src)(v1.value0.nodes);
                        if ($277 instanceof Left) {
                          return new Left(renderParseErrorAt(src)($277.value0));
                        }
                        ;
                        return v4(true);
                      }
                      ;
                      return v4(true);
                    }
                    ;
                    return v4(true);
                  };
                  if (v1 instanceof Right) {
                    var $282 = checkSurfaceStrict(strict)(v1.value0.nodes);
                    if ($282 instanceof Left) {
                      return new Left(renderParseErrorAt(src)($282.value0));
                    }
                    ;
                    return v2(true);
                  }
                  ;
                  return v2(true);
                }
                ;
                throw new Error("Failed pattern match at ClassicBars (line 362, column 3 - line 385, column 35): " + [v.constructor.name]);
              };
            };
          };
        };
      };
    };
  };
};
var renderSurfaceWithHelpers = /* @__PURE__ */ renderSurfaceWithHelpersWith(true)(noLoopVars)(/* @__PURE__ */ surfaceParseOf(defaultParseOptions))(handlebars);
var analyseSurfaceWith = function(schema) {
  return function(src) {
    return function(dat) {
      var v = parse(src);
      if (v instanceof Left) {
        return new Left(renderParseErrorsAt(src)(v.value0));
      }
      ;
      var v1 = function(v2) {
        if (v instanceof Right) {
          var v3 = hoistInline(desugarSurface(v.value0.nodes));
          var v4 = runAnalysis(refEngineWith2(lenientResolve2))(registerPartials(v3.partials))(v3.template)(dat);
          if (v4 instanceof Left) {
            return new Left(formatError(src)(v4.value0));
          }
          ;
          if (v4 instanceof Right) {
            return new Right({
              output: v4.value0.output,
              report: reportMarkdown(schema)(src)(v4.value0.decisions) + i18nNote(v3.template),
              jsonata: jsonataScaffold(src)(v4.value0.decisions),
              findings: allFindings(handlebarsLabels)(schema)(src)(v4.value0.decisions),
              evaluated: evaluatedCount(v4.value0.decisions)
            });
          }
          ;
          throw new Error("Failed pattern match at ClassicBars (line 500, column 7 - line 510, column 12): " + [v4.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars (line 482, column 1 - line 492, column 9): " + [v.constructor.name]);
      };
      if (v instanceof Right) {
        var $299 = checkSurfaceStrict(true)(v.value0.nodes);
        if ($299 instanceof Left) {
          return new Left(renderParseErrorAt(src)($299.value0));
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
};
var analyseSurface = /* @__PURE__ */ analyseSurfaceWith(anyPath);

// output/FlatBars.Compile/index.js
var $runtime_lazy5 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var foldMap5 = /* @__PURE__ */ foldMap(foldableArray)(monoidString);
var show11 = /* @__PURE__ */ show(showInt);
var map25 = /* @__PURE__ */ map(functorArray);
var stmtOut = function(e) {
  return "  out += " + (e + ";\n");
};
var jsString = function(s) {
  var esc = function(c) {
    if (c === '"') {
      return '\\"';
    }
    ;
    if (c === "\\") {
      return "\\\\";
    }
    ;
    if (c === "\n") {
      return "\\n";
    }
    ;
    if (c === "\r") {
      return "\\r";
    }
    ;
    if (c === "	") {
      return "\\t";
    }
    ;
    if (c === "\u2028") {
      return "\\u2028";
    }
    ;
    if (c === "\u2029") {
      return "\\u2029";
    }
    ;
    return singleton5(c);
  };
  return '"' + (foldMap5(esc)(toCharArray(s)) + '"');
};
var compile = function(meta) {
  return function(emit2) {
    return function(partials) {
      return function(main) {
        var rec = {
          expr: function(ctx2) {
            return function(e) {
              return emit2.expr(rec)(ctx2)(e);
            };
          },
          nodes: function(ctx2) {
            return function(ts) {
              return foldMap5(node2(ctx2))(ts);
            };
          },
          child: function(ctx2) {
            return {
              scope: "c" + show11(ctx2.depth + 1 | 0),
              depth: ctx2.depth + 1 | 0
            };
          }
        };
        var node2 = function(ctx2) {
          return function(v) {
            if (v instanceof Content) {
              return stmtOut(jsString(v.value1));
            }
            ;
            if (v instanceof Output) {
              return stmtOut("rt.out(" + (rec.expr(ctx2)(v.value1) + ")"));
            }
            ;
            if (v instanceof Block) {
              return emit2.block(rec)(ctx2)(v.value2)(v.value3)(v.value4);
            }
            ;
            if (v instanceof Sep) {
              return stmtOut("rt.out(rt.call(" + (jsString(v.value1) + (", [" + (commaArgs(ctx2)(v.value2) + ("], " + (ctx2.scope + "))"))))));
            }
            ;
            if (v instanceof RawBlock) {
              return stmtOut("rt.raw(" + (jsString(v.value1) + (", [" + (commaArgs(ctx2)(v.value2) + ("], " + (jsString(v.value3) + (", " + (ctx2.scope + ")"))))))));
            }
            ;
            if (v instanceof NodeError) {
              return "";
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Compile (line 122, column 14 - line 144, column 24): " + [v.constructor.name]);
          };
        };
        var commaArgs = function(ctx2) {
          var $33 = joinWith(", ");
          var $34 = map25(rec.expr(ctx2));
          return function($35) {
            return $33($34($35));
          };
        };
        var fn = function(withRegistry) {
          return function(t) {
            return "function (data, rt, partials) {\n  partials = partials || {};\n" + ((function() {
              if (withRegistry) {
                return $lazy_registry(104);
              }
              ;
              return "";
            })() + ('  let out = "";\n  const c0 = ' + (meta.seed + (";\n" + (rec.nodes({
              scope: "c0",
              depth: 0
            })(t) + "  return out;\n}")))));
          };
        };
        var $lazy_registry = $runtime_lazy5("registry", "FlatBars.Compile", function() {
          if ($$null(partials)) {
            return "";
          }
          ;
          if (otherwise) {
            return "  partials = Object.assign({}, partials, {\n" + (joinWith(",\n")(map25(function(v) {
              return "    " + (jsString(v.value0) + (": " + fn(false)(v.value1)));
            })(partials)) + "\n  });\n");
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Compile (line 111, column 3 - line 111, column 21): ");
        });
        var registry = $lazy_registry(111);
        return "// flatbars-compiled \u2014 runtime " + (meta.runtimeVersion + ("\n" + ("export const runtimeVersion = " + (jsString(meta.runtimeVersion) + (";\n" + (meta.preamble + ("export default " + (fn(true)(main) + "\n"))))))));
      };
    };
  };
};

// output/FlatBars.Compile.Emit/index.js
var show14 = /* @__PURE__ */ show(showNumber);
var map26 = /* @__PURE__ */ map(functorArray);
var append16 = /* @__PURE__ */ append(semigroupArray);
var pure9 = /* @__PURE__ */ pure(applicativeArray);
var elem11 = /* @__PURE__ */ elem2(eqString);
var truthyTest = function(rec) {
  return function(ctx2) {
    return function(args) {
      if (args.length === 1) {
        return "rt.truthy(" + (ctx2.scope + (".truthy, " + (rec.expr(ctx2)(args[0]) + ")")));
      }
      ;
      if (args.length === 2) {
        return "rt.truthyWith(" + (ctx2.scope + (".truthy, " + (rec.expr(ctx2)(args[0]) + (", " + (rec.expr(ctx2)(args[1]) + ")")))));
      }
      ;
      return "false";
    };
  };
};
var runtimeVersion = "0.2.0";
var metaFor = function(truthyCallback) {
  return function(yieldName) {
    return {
      runtimeVersion,
      preamble: "",
      seed: "rt.scope(data, " + (truthyCallback + (", " + (jsString(yieldName) + ")")))
    };
  };
};
var litJs = function(v) {
  if (v instanceof VString) {
    return jsString(v.value0);
  }
  ;
  if (v instanceof VNumber) {
    return show14(v.value0);
  }
  ;
  if (v instanceof VBool) {
    if (v.value0) {
      return "true";
    }
    ;
    return "false";
  }
  ;
  if (v instanceof VNull) {
    return "null";
  }
  ;
  if (v instanceof VSafe) {
    return "rt.safe(" + (jsString(v.value0) + ")");
  }
  ;
  if (v instanceof VArray) {
    return "null";
  }
  ;
  if (v instanceof VObject) {
    return "null";
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 95, column 9 - line 102, column 22): " + [v.constructor.name]);
};
var lambda = function(rec) {
  return function(ctx2) {
    return function(body) {
      return "function (" + (ctx2.scope + (') { let out = "";\n' + (rec.nodes(ctx2)(body) + "  return out; }")));
    };
  };
};
var letBlock = function(rec) {
  return function(ctx2) {
    return function(split2) {
      return function(body) {
        var objsJs = map26(rec.expr(ctx2))(append16(maybe([])(pure9)(split2.hash))(split2.positional));
        var child = rec.child(ctx2);
        return "  out += rt.letScope(" + (ctx2.scope + (", [" + (joinWith(", ")(objsJs) + ("], " + (lambda(rec)(child)(body) + ");\n")))));
      };
    };
  };
};
var head1 = function(rec) {
  return function(ctx2) {
    return function(args) {
      var v = head(args);
      if (v instanceof Just) {
        return rec.expr(ctx2)(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        return "null";
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 347, column 22 - line 349, column 20): " + [v.constructor.name]);
    };
  };
};
var elseChain = function(rec) {
  return function(ctx2) {
    return function(clauses) {
      var v = uncons(clauses);
      if (v instanceof Nothing) {
        return "";
      }
      ;
      if (v instanceof Just) {
        if (v.value0.head.name === "elif") {
          return " else if (" + (truthyTest(rec)(ctx2)(v.value0.head.args) + (") {\n" + (rec.nodes(ctx2)(v.value0.head.body) + ("  }" + elseChain(rec)(ctx2)(v.value0.tail)))));
        }
        ;
        return " else {\n" + (rec.nodes(ctx2)(v.value0.head.body) + "  }");
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 223, column 29 - line 234, column 55): " + [v.constructor.name]);
    };
  };
};
var ifBlock = function(rec) {
  return function(ctx2) {
    return function(test) {
      return function(body) {
        var s = splitClauses(body);
        return "  if (" + (test + (") {\n" + (rec.nodes(ctx2)(s.before) + ("  }" + (elseChain(rec)(ctx2)(s.clauses) + "\n")))));
      };
    };
  };
};
var clausesObj = function(rec) {
  return function(ctx2) {
    return function(clauses) {
      var one2 = function(cl) {
        return jsString(cl.name) + (": " + lambda(rec)(rec.child(ctx2))(cl.body));
      };
      return "{" + (joinWith(", ")(map26(one2)(clauses)) + "}");
    };
  };
};
var caseEq = function(rec) {
  return function(ctx2) {
    return function(v) {
      return "rt.call(" + (jsString("eq") + (", [__case, " + (rec.expr(ctx2)(v) + ("], " + (ctx2.scope + ")")))));
    };
  };
};
var caseChain = function(rec) {
  return function(ctx2) {
    return function(first) {
      return function(clauses) {
        var v = uncons(clauses);
        if (v instanceof Nothing) {
          return "";
        }
        ;
        if (v instanceof Just) {
          if (v.value0.head.name === "when") {
            var kw = (function() {
              if (first) {
                return "  if (";
              }
              ;
              return " else if (";
            })();
            var guard2 = (function() {
              if (v.value0.head.args.length === 0) {
                return "false";
              }
              ;
              return joinWith(" || ")(map26(caseEq(rec)(ctx2))(v.value0.head.args));
            })();
            return kw + (guard2 + (") {\n" + (rec.nodes(ctx2)(v.value0.head.body) + ("  }" + caseChain(rec)(ctx2)(false)(v.value0.tail)))));
          }
          ;
          if (first) {
            return "  {\n" + (rec.nodes(ctx2)(v.value0.head.body) + "  }");
          }
          ;
          return " else {\n" + (rec.nodes(ctx2)(v.value0.head.body) + "  }");
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 201, column 35 - line 214, column 55): " + [v.constructor.name]);
      };
    };
  };
};
var caseBlock = function(rec) {
  return function(ctx2) {
    return function(positional) {
      return function(body) {
        var subject = (function() {
          if (positional.length === 1) {
            return positional[0];
          }
          ;
          return new App2("null", []);
        })();
        var s = splitClauses(body);
        return "  {\n  const __case = " + (rec.expr(ctx2)(subject) + (";\n" + (caseChain(rec)(ctx2)(true)(s.clauses) + "\n  }\n")));
      };
    };
  };
};
var bodyThunk = function(rec) {
  return function(ctx2) {
    return function(body) {
      return 'function () { let out = "";\n' + (rec.nodes(ctx2)(body) + "  return out; }");
    };
  };
};
var bindingNames2 = /* @__PURE__ */ mapMaybe(function(v) {
  if (v instanceof Lit && v.value0 instanceof VString) {
    return new Just(v.value0.value0);
  }
  ;
  return Nothing.value;
});
var frameBlock = function(rec) {
  return function(ctx2) {
    return function(fn) {
      return function(args) {
        return function(label) {
          return function(body) {
            var subject = head1(rec)(ctx2)(args);
            var s = splitClauses(body);
            var names = "[" + (joinWith(", ")(map26(jsString)(bindingNames2(drop(1)(args)))) + "]");
            var labelJs = maybe("null")(jsString)(label);
            var elseClause = (function() {
              var v = head(s.clauses);
              if (v instanceof Just) {
                return v.value0.body;
              }
              ;
              if (v instanceof Nothing) {
                return [];
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 251, column 18 - line 253, column 20): " + [v.constructor.name]);
            })();
            var child = rec.child(ctx2);
            return "  out += rt." + (fn + ("(" + (subject + (", " + (ctx2.scope + (", " + (names + (", " + (labelJs + (", " + (lambda(rec)(child)(s.before) + (", " + (lambda(rec)(ctx2)(elseClause) + ");\n")))))))))))));
          };
        };
      };
    };
  };
};
var args$prime = function(rec) {
  return function(ctx2) {
    var $72 = joinWith(", ");
    var $73 = map26(rec.expr(ctx2));
    return function($74) {
      return $72($73($74));
    };
  };
};
var rtBlock = function(section) {
  return function(rec) {
    return function(ctx2) {
      return function(name2) {
        return function(split2) {
          return function(body) {
            var s = splitClauses(body);
            var paramsJs = "[" + (joinWith(", ")(map26(jsString)(split2.params)) + "]");
            var nDrop = length(split2.params) + (function() {
              var $51 = isJust(split2.hash);
              if ($51) {
                return 1;
              }
              ;
              return 0;
            })() | 0;
            var realArgs = take(length(split2.positional) - nDrop | 0)(split2.positional);
            var hashJs = maybe("null")(rec.expr(ctx2))(split2.hash);
            return "  out += rt.block(" + (jsString(name2) + (", [" + (args$prime(rec)(ctx2)(realArgs) + ("], " + (ctx2.scope + (", " + (lambda(rec)(rec.child(ctx2))(s.before) + (", " + (clausesObj(rec)(ctx2)(s.clauses) + (", { hash: " + (hashJs + (", params: " + (paramsJs + (", section: " + ((function() {
              if (section) {
                return "true";
              }
              ;
              return "false";
            })() + " });\n")))))))))))))));
          };
        };
      };
    };
  };
};
var argAt = function(rec) {
  return function(ctx2) {
    return function(args) {
      return function(i) {
        var v = index(args)(i);
        if (v instanceof Just) {
          return rec.expr(ctx2)(v.value0);
        }
        ;
        if (v instanceof Nothing) {
          return "null";
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 90, column 24 - line 92, column 20): " + [v.constructor.name]);
      };
    };
  };
};
var fbBlock = function(lenient) {
  return function(rec) {
    return function(ctx2) {
      return function(name2) {
        return function(args) {
          return function(body) {
            var split2 = splitBlockArgs(args);
            var section = lenient && (elem11(name2)(sectionableValueNames) && $$null(split2.positional));
            if (name2 === "if") {
              return ifBlock(rec)(ctx2)(truthyTest(rec)(ctx2)(split2.positional))(body);
            }
            ;
            if (name2 === "unless") {
              return ifBlock(rec)(ctx2)("!(" + (truthyTest(rec)(ctx2)(split2.positional) + ")"))(body);
            }
            ;
            if (name2 === "each") {
              return frameBlock(rec)(ctx2)("each")(split2.positional)(split2.label)(body);
            }
            ;
            if (name2 === "with") {
              return frameBlock(rec)(ctx2)("with")(split2.positional)(split2.label)(body);
            }
            ;
            if (name2 === "local") {
              return letBlock(rec)(ctx2)(split2)(body);
            }
            ;
            if (name2 === "case") {
              return caseBlock(rec)(ctx2)(split2.positional)(body);
            }
            ;
            if (name2 === "inline") {
              return "";
            }
            ;
            if (name2 === "partial") {
              return "  out += rt.partialBlock(" + (argAt(rec)(ctx2)(args)(0) + (", " + (argAt(rec)(ctx2)(args)(1) + (", " + (argAt(rec)(ctx2)(args)(2) + (", partials, rt, " + (bodyThunk(rec)(ctx2)(body) + ");\n")))))));
            }
            ;
            return rtBlock(section)(rec)(ctx2)(name2)(split2)(body);
          };
        };
      };
    };
  };
};
var fbExpr = function(rec) {
  return function(ctx2) {
    return function(v) {
      if (v instanceof Lit) {
        return litJs(v.value0);
      }
      ;
      if (v instanceof App2 && (v.value0 === "this" && v.value1.length === 0)) {
        return ctx2.scope + ".ctx";
      }
      ;
      if (v instanceof App2 && v.value0 === "lookup") {
        return "rt.lookup(" + (args$prime(rec)(ctx2)(v.value1) + ")");
      }
      ;
      if (v instanceof App2 && (v.value0 === "escapeHtml" && v.value1.length === 1)) {
        return "rt.esc(" + (rec.expr(ctx2)(v["value1"][0]) + ")");
      }
      ;
      if (v instanceof App2 && (v.value0 === "safe" && v.value1.length === 1)) {
        return "rt.safe(" + (rec.expr(ctx2)(v["value1"][0]) + ")");
      }
      ;
      if (v instanceof App2 && v.value0 === "partial") {
        return "rt.partial(" + (argAt(rec)(ctx2)(v.value1)(0) + (", " + (argAt(rec)(ctx2)(v.value1)(1) + (", " + (argAt(rec)(ctx2)(v.value1)(2) + ", partials, rt)")))));
      }
      ;
      if (v instanceof App2) {
        return "rt.call(" + (jsString(v.value0) + (", [" + (args$prime(rec)(ctx2)(v.value1) + ("], " + (ctx2.scope + ")")))));
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 72, column 18 - line 85, column 92): " + [v.constructor.name]);
    };
  };
};
var emitWith = function(lenient) {
  return {
    expr: fbExpr,
    block: fbBlock(lenient)
  };
};
var classicbarsEmit = /* @__PURE__ */ emitWith(true);
var coreEmit = /* @__PURE__ */ emitWith(false);

// output/ClassicBars.Compile/index.js
var bind9 = /* @__PURE__ */ bind(bindEither);
var lmap3 = /* @__PURE__ */ lmap(bifunctorEither);
var pure10 = /* @__PURE__ */ pure(applicativeEither);
var traverse8 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var discard7 = /* @__PURE__ */ discard(discardUnit)(bindEither);
var when5 = /* @__PURE__ */ when(applicativeEither);
var fromFoldable10 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var union9 = /* @__PURE__ */ union(ordString);
var toUnfoldable7 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var compileSurfaceWithPartials = function(strict) {
  return function(lv) {
    return function(sp) {
      return function(truthyCallback) {
        return function(partialSrcs) {
          return function(src) {
            var compilePartial = function(v) {
              return bind9(lmap3(head2)(sp.parse(v.value1)))(function(v1) {
                var lifted = (function() {
                  if (sp.statementTags) {
                    return renameSurfaceHeads(liftSet(v1.nodes));
                  }
                  ;
                  return v1.nodes;
                })();
                return pure10(new Tuple(v.value0, desugarSurfaceWith(lv)(lifted)));
              });
            };
            return bind9(traverse8(compilePartial)(partialSrcs))(function(externals) {
              return bind9(lmap3(head2)(sp.parse(src)))(function(v) {
                return discard7(checkSurfaceStrict(strict)(v.nodes))(function() {
                  return discard7(when5(sp.statementTags)(checkBraceControl(src)(v.nodes)))(function() {
                    return bind9((function() {
                      if (sp.statementTags) {
                        return resolveInheritance(v.nodes);
                      }
                      ;
                      return new Right(v.nodes);
                    })())(function(inherited) {
                      var lifted = (function() {
                        if (sp.statementTags) {
                          return renameSurfaceHeads(liftSet(inherited));
                        }
                        ;
                        return inherited;
                      })();
                      var h = hoistInline(desugarSurfaceWith(lv)(lifted));
                      var externalT = fromFoldable10(externals);
                      var registry = union9(h.partials)(externalT);
                      return pure10(compile(metaFor(truthyCallback)((function() {
                        if (sp.partialBlocks) {
                          return "partial-block";
                        }
                        ;
                        return "yield";
                      })()))(classicbarsEmit)(toUnfoldable7(registry))(h.template));
                    });
                  });
                });
              });
            });
          };
        };
      };
    };
  };
};
var compileSurfaceWith = function(strict) {
  return function(lv) {
    return function(sp) {
      return function(truthyCallback) {
        return compileSurfaceWithPartials(strict)(lv)(sp)(truthyCallback)([]);
      };
    };
  };
};
var compileSurface = /* @__PURE__ */ compileSurfaceWith(true)(noLoopVars)(/* @__PURE__ */ surfaceParseOf(defaultParseOptions))("rt.truthyHandlebars");

// output/Data.Argonaut.Core/foreign.js
function id(x) {
  return x;
}
var jsonNull = null;
function _caseJson(isNull, isBool, isNum, isStr, isArr, isObj, j) {
  if (j == null) return isNull();
  else if (typeof j === "boolean") return isBool(j);
  else if (typeof j === "number") return isNum(j);
  else if (typeof j === "string") return isStr(j);
  else if (Object.prototype.toString.call(j) === "[object Array]")
    return isArr(j);
  else return isObj(j);
}

// output/Foreign.Object/foreign.js
var empty4 = {};
function runST(f) {
  return f();
}
function _lookup(no, yes, k, m) {
  return k in m ? yes(m[k]) : no;
}
function toArrayWithKey(f) {
  return function(m) {
    var r = [];
    for (var k in m) {
      if (hasOwnProperty.call(m, k)) {
        r.push(f(k)(m[k]));
      }
    }
    return r;
  };
}
var keys3 = Object.keys || toArrayWithKey(function(k) {
  return function() {
    return k;
  };
});

// output/Foreign.Object.ST/foreign.js
var newImpl = function() {
  return {};
};
function poke2(k) {
  return function(v) {
    return function(m) {
      return function() {
        m[k] = v;
        return m;
      };
    };
  };
}

// output/Foreign.Object/index.js
var $$void3 = /* @__PURE__ */ $$void(functorST);
var toUnfoldable8 = function(dictUnfoldable) {
  var $89 = toUnfoldable(dictUnfoldable);
  var $90 = toArrayWithKey(Tuple.create);
  return function($91) {
    return $89($90($91));
  };
};
var lookup8 = /* @__PURE__ */ (function() {
  return runFn4(_lookup)(Nothing.value)(Just.create);
})();
var fromFoldable11 = function(dictFoldable) {
  var fromFoldable111 = fromFoldable(dictFoldable);
  return function(l) {
    return runST(function __do() {
      var s = newImpl();
      foreach(fromFoldable111(l))(function(v) {
        return $$void3(poke2(v.value0)(v.value1)(s));
      })();
      return s;
    });
  };
};

// output/Data.Argonaut.Core/index.js
var caseJsonString = function(d) {
  return function(f) {
    return function(j) {
      return _caseJson($$const(d), $$const(d), $$const(d), f, $$const(d), $$const(d), j);
    };
  };
};
var caseJsonObject = function(d) {
  return function(f) {
    return function(j) {
      return _caseJson($$const(d), $$const(d), $$const(d), $$const(d), $$const(d), f, j);
    };
  };
};
var caseJsonArray = function(d) {
  return function(f) {
    return function(j) {
      return _caseJson($$const(d), $$const(d), $$const(d), $$const(d), f, $$const(d), j);
    };
  };
};
var caseJson = function(a) {
  return function(b) {
    return function(c) {
      return function(d) {
        return function(e) {
          return function(f) {
            return function(json) {
              return _caseJson(a, b, c, d, e, f, json);
            };
          };
        };
      };
    };
  };
};

// output/FlatBars.Highlight/index.js
var eq14 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var append4 = /* @__PURE__ */ append(semigroupArray);
var elem13 = /* @__PURE__ */ elem2(eqString);
var isSpace3 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var trimmedChars = /* @__PURE__ */ (function() {
  var $62 = dropWhile(isSpace3);
  return function($63) {
    return $62(toCharArray($63));
  };
})();
var isPartialHead = function(s) {
  return eq14(head(trimmedChars(s)))(new Just(">"));
};
var headWord = function(s) {
  return fromCharArray(takeWhile(function($64) {
    return !isSpace3($64);
  })(trimmedChars(s)));
};
var tokenizeSpans = function(cfg) {
  return function(src) {
    var tag = function(sp) {
      return function(kind) {
        return [{
          from: sp.start,
          to: sp.end,
          kind,
          role: "tag"
        }];
      };
    };
    var carve = function(pt) {
      return function(kind) {
        return {
          from: pt.at,
          to: pt.end,
          kind,
          role: "interior"
        };
      };
    };
    var interiorSpan = function(pt) {
      if (pt.tok instanceof TStr) {
        return new Just(carve(pt)("string"));
      }
      ;
      if (pt.tok instanceof TNum) {
        return new Just(carve(pt)("number"));
      }
      ;
      if (pt.tok instanceof TOp) {
        return new Just(carve(pt)("operator"));
      }
      ;
      return Nothing.value;
    };
    var carveInterior = function(v2) {
      if (v2 instanceof Left) {
        return [];
      }
      ;
      if (v2 instanceof Right) {
        return mapMaybe(interiorSpan)(v2.value0);
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Highlight (line 173, column 19 - line 175, column 51): " + [v2.constructor.name]);
    };
    var openSpans = function(sp) {
      return function(sig) {
        return function($$int2) {
          if (sig instanceof Section) {
            return append4(tag(sp)("block-open"))(carveInterior($$int2));
          }
          ;
          if (sig instanceof PartialBlock) {
            return append4(tag(sp)("block-open"))(carveInterior($$int2));
          }
          ;
          if (sig instanceof Decorator) {
            return append4(tag(sp)("block-open"))(carveInterior($$int2));
          }
          ;
          if (sig instanceof Inverse) {
            if (cfg.extras) {
              return append4(tag(sp)("block-inverse"))(carveInterior($$int2));
            }
            ;
            if (otherwise) {
              return tag(sp)("error");
            }
            ;
          }
          ;
          if (sig instanceof Parent) {
            if (cfg.inheritance) {
              return append4(tag(sp)("block-parent"))(carveInterior($$int2));
            }
            ;
            if (otherwise) {
              return tag(sp)("error");
            }
            ;
          }
          ;
          if (sig instanceof BlockDef) {
            if (cfg.inheritance) {
              return append4(tag(sp)("block-decl"))(carveInterior($$int2));
            }
            ;
            if (otherwise) {
              return tag(sp)("error");
            }
            ;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Highlight (line 151, column 26 - line 165, column 36): " + [sig.constructor.name]);
        };
      };
    };
    var spansOf = function(v2) {
      if (v2 instanceof RContent) {
        return [];
      }
      ;
      if (v2 instanceof ROutput) {
        return append4(tag(v2.value0)("raw"))(carveInterior(v2.value3));
      }
      ;
      if (v2 instanceof RAmp) {
        if (cfg.extras) {
          return append4(tag(v2.value0)("raw"))(carveInterior(v2.value3));
        }
        ;
        if (otherwise) {
          return tag(v2.value0)("error");
        }
        ;
      }
      ;
      if (v2 instanceof ROpen) {
        return openSpans(v2.value0)(v2.value1)(v2.value4);
      }
      ;
      if (v2 instanceof RClose) {
        return append4(tag(v2.value0)("block-close"))(carveInterior(v2.value3));
      }
      ;
      if (v2 instanceof RSep) {
        if (isPartialHead(v2.value2)) {
          return tag(v2.value0)("partial");
        }
        ;
        if (elem13(headWord(v2.value2))(cfg.clauseSeps)) {
          return append4(tag(v2.value0)("keyword"))(carveInterior(v2.value3));
        }
        ;
        if (otherwise) {
          return append4(tag(v2.value0)("expr"))(carveInterior(v2.value3));
        }
        ;
      }
      ;
      if (v2 instanceof RRaw) {
        if (v2.value1 && cfg.rawBlockHash) {
          return tag(v2.value0)("raw-block");
        }
        ;
        if (!v2.value1 && cfg.rawBlockHbs) {
          return tag(v2.value0)("raw-block");
        }
        ;
        if (otherwise) {
          return tag(v2.value0)("error");
        }
        ;
      }
      ;
      if (v2 instanceof RComment) {
        return tag(v2.value0)("comment");
      }
      ;
      if (v2 instanceof RLongComment) {
        return tag(v2.value0)("comment");
      }
      ;
      if (v2 instanceof RSetDelim) {
        return tag(v2.value0)("set-delimiter");
      }
      ;
      if (v2 instanceof RError) {
        return tag(v2.value0)("unterminated");
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Highlight (line 113, column 13 - line 144, column 41): " + [v2.constructor.name]);
    };
    var v = tokenizeTemplate(cfg.lexConfig)(src);
    if (v instanceof Left) {
      return [];
    }
    ;
    if (v instanceof Right) {
      return concatMap(spansOf)(v.value0);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Highlight (line 108, column 25 - line 110, column 45): " + [v.constructor.name]);
  };
};
var highlightSpans = function(cfg) {
  return function(src) {
    var tagOnly = function(s) {
      if (s.role === "tag") {
        return new Just({
          from: s.from,
          to: s.to,
          kind: s.kind
        });
      }
      ;
      if (otherwise) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Highlight (line 196, column 3 - line 196, column 34): " + [s.constructor.name]);
    };
    return mapMaybe(tagOnly)(tokenizeSpans(cfg)(src));
  };
};

// output/FlatBars.Json/index.js
var $runtime_lazy6 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var map27 = /* @__PURE__ */ map(functorArray);
var fromFoldable12 = /* @__PURE__ */ fromFoldable11(foldableArray);
var toUnfoldable9 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var fromFoldable1 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var toUnfoldable1 = /* @__PURE__ */ toUnfoldable8(unfoldableArray);
var toJson = function(v) {
  if (v instanceof VString) {
    return id(v.value0);
  }
  ;
  if (v instanceof VSafe) {
    return id(v.value0);
  }
  ;
  if (v instanceof VNumber) {
    return id(v.value0);
  }
  ;
  if (v instanceof VBool) {
    return id(v.value0);
  }
  ;
  if (v instanceof VNull) {
    return jsonNull;
  }
  ;
  if (v instanceof VArray) {
    return id(map27(toJson)(v.value0));
  }
  ;
  if (v instanceof VObject) {
    return id(fromFoldable12(map27(function(v1) {
      return new Tuple(v1.value0, toJson(v1.value1));
    })(toUnfoldable9(v.value0))));
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Json (line 35, column 10 - line 47, column 6): " + [v.constructor.name]);
};
var $lazy_fromJson = /* @__PURE__ */ $runtime_lazy6("fromJson", "FlatBars.Json", function() {
  return caseJson(function(v) {
    return VNull.value;
  })(VBool.create)(VNumber.create)(VString.create)(function(arr2) {
    return new VArray(map27($lazy_fromJson(25))(arr2));
  })(function(obj2) {
    return new VObject(fromFoldable1(map27(function(v) {
      return new Tuple(v.value0, $lazy_fromJson(28)(v.value1));
    })(toUnfoldable1(obj2))));
  });
});
var fromJson = /* @__PURE__ */ $lazy_fromJson(19);

// output/Linter.Aliases/index.js
var lookup9 = /* @__PURE__ */ lookup(foldableArray)(eqString);
var scopedCanonWarnings = /* @__PURE__ */ (function() {
  var warnOf = function(ref) {
    var v = lookup9(ref.name)(scopedCanonical);
    if (v instanceof Just) {
      return new Just({
        severity: Warn.value,
        name: ref.name,
        message: "`" + (ref.name + ("` is the non-canonical scoped variable \u2014 prefer `" + (v.value0 + "` (the native RawBars/MaxBars spelling)"))),
        span: ref.span
      });
    }
    ;
    if (v instanceof Nothing) {
      return Nothing.value;
    }
    ;
    throw new Error("Failed pattern match at Linter.Aliases (line 87, column 16 - line 96, column 23): " + [v.constructor.name]);
  };
  var $14 = mapMaybe(warnOf);
  return function($15) {
    return $14(operationRefs($15));
  };
})();
var aliasWarnings = /* @__PURE__ */ (function() {
  var warnOf = function(ref) {
    var v = lookup9(ref.name)(preludeAliases);
    if (v instanceof Just) {
      return new Just({
        severity: Warn.value,
        name: ref.name,
        message: "`" + (ref.name + ("` is a deprecated alias of `" + (v.value0 + ("` \u2014 prefer `" + (v.value0 + "` (the lift/migrate assist rewrites it)"))))),
        span: ref.span
      });
    }
    ;
    if (v instanceof Nothing) {
      return Nothing.value;
    }
    ;
    throw new Error("Failed pattern match at Linter.Aliases (line 60, column 16 - line 71, column 23): " + [v.constructor.name]);
  };
  var $17 = mapMaybe(warnOf);
  return function($18) {
    return $17(operationRefs($18));
  };
})();

// output/Linter.Migrate/index.js
var eq15 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var lookup10 = /* @__PURE__ */ lookup(foldableArray)(eqString);
var elem14 = /* @__PURE__ */ elem2(eqString);
var bind10 = /* @__PURE__ */ bind(bindEither);
var pure11 = /* @__PURE__ */ pure(applicativeEither);
var append17 = /* @__PURE__ */ append(semigroupArray);
var CloseUnless = /* @__PURE__ */ (function() {
  function CloseUnless2() {
  }
  ;
  CloseUnless2.value = new CloseUnless2();
  return CloseUnless2;
})();
var CloseEnd = /* @__PURE__ */ (function() {
  function CloseEnd2() {
  }
  ;
  CloseEnd2.value = new CloseEnd2();
  return CloseEnd2;
})();
var ClosePartial = /* @__PURE__ */ (function() {
  function ClosePartial2() {
  }
  ;
  ClosePartial2.value = new ClosePartial2();
  return ClosePartial2;
})();
var trimsOf = function(slice6) {
  return {
    l: take2(3)(slice6) === "{{~",
    r: takeRight(3)(slice6) === "~}}"
  };
};
var stripTildes = function(s) {
  var a = fromMaybe(s)(stripPrefix("~")(s));
  return fromMaybe(a)(stripSuffix("~")(a));
};
var stripDotDot = function($copy_s) {
  return function($copy_depth) {
    var $tco_var_s = $copy_s;
    var $tco_done = false;
    var $tco_result;
    function $tco_loop(s, depth) {
      var v = stripPrefix("../")(s);
      if (v instanceof Just) {
        $tco_var_s = v.value0;
        $copy_depth = depth + 1 | 0;
        return;
      }
      ;
      if (v instanceof Nothing) {
        $tco_done = true;
        return {
          depth,
          rest: s
        };
      }
      ;
      throw new Error("Failed pattern match at Linter.Migrate (line 365, column 23 - line 367, column 32): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_s, $copy_depth);
    }
    ;
    return $tco_result;
  };
};
var stmtTag = function(tr) {
  return function(head4) {
    return "{%" + ((function() {
      if (tr.l) {
        return "~";
      }
      ;
      return "";
    })() + (" " + (trim(head4) + (" " + ((function() {
      if (tr.r) {
        return "~";
      }
      ;
      return "";
    })() + "%}")))));
  };
};
var sliceSpan = function(src) {
  return function(span2) {
    return slice2(span2.start)(span2.end)(src);
  };
};
var quoteHead = function(kw) {
  return function(s) {
    var t = trim(s);
    var v = indexOf2(" ")(t);
    if (v instanceof Nothing) {
      return kw + (' "' + (t + '"'));
    }
    ;
    if (v instanceof Just) {
      return kw + (' "' + (take2(v.value0)(t) + ('" ' + trim(drop2(v.value0)(t)))));
    }
    ;
    throw new Error("Failed pattern match at Linter.Migrate (line 267, column 5 - line 269, column 83): " + [v.constructor.name]);
  };
};
var push2 = function(acc) {
  return function(r) {
    return {
      chunks: acc.chunks,
      residuals: acc.residuals,
      stack: cons(r)(acc.stack)
    };
  };
};
var popStack = function(acc) {
  return {
    chunks: acc.chunks,
    residuals: acc.residuals,
    stack: fromMaybe([])(tail(acc.stack))
  };
};
var partialInclude = function(interior) {
  var v = stripPrefix(">")(trim(interior));
  if (v instanceof Nothing) {
    return Nothing.value;
  }
  ;
  if (v instanceof Just) {
    var r = trim(v.value0);
    var $54 = r === "" || r === "@partial-block";
    if ($54) {
      return Nothing.value;
    }
    ;
    return new Just(quoteHead("include")(r));
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 252, column 27 - line 258, column 89): " + [v.constructor.name]);
};
var matchAt2 = function(cs) {
  return function(i) {
    return function(pat) {
      var pcs = toCharArray(pat);
      return eq15(slice(i)(i + length(pcs) | 0)(cs))(pcs);
    };
  };
};
var loopField = function(name2) {
  return lookup10(name2)(loopFieldCanonical);
};
var knownBlockHelpers = blockHelperNames;
var joinReplicate = function(n) {
  return function(sep) {
    return joinWith("")(replicate(n)(sep));
  };
};
var migrateAtName = function(name2) {
  var v = stripDotDot(name2)(0);
  var $57 = v.depth > 0;
  if ($57) {
    return new Just((function() {
      var v12 = loopField(v.rest);
      if (v12 instanceof Just) {
        return "loop" + (joinReplicate(v.depth)(".parent") + ("." + v12.value0));
      }
      ;
      if (v12 instanceof Nothing) {
        var chain = joinWith(".")(replicate(v.depth)("parent"));
        var $60 = v.rest === "";
        if ($60) {
          return chain;
        }
        ;
        return chain + ("." + v.rest);
      }
      ;
      throw new Error("Failed pattern match at Linter.Migrate (line 342, column 9 - line 348, column 65): " + [v12.constructor.name]);
    })());
  }
  ;
  var v1 = loopField(name2);
  if (v1 instanceof Just) {
    return new Just("loop." + v1.value0);
  }
  ;
  if (name2 === "root" || (isJust(stripPrefix("root.")(name2)) || isJust(stripPrefix("root/")(name2)))) {
    return new Just(name2);
  }
  ;
  if (otherwise) {
    return Nothing.value;
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 350, column 10 - line 355, column 31): " + [v1.constructor.name]);
};
var isPartialBlockRef = function(interior) {
  var v = stripPrefix(">")(trim(interior));
  if (v instanceof Just) {
    return trim(v.value0) === "@partial-block";
  }
  ;
  if (v instanceof Nothing) {
    return false;
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 243, column 30 - line 245, column 19): " + [v.constructor.name]);
};
var isIdentChar2 = function(c) {
  return c >= "a" && c <= "z" || (c >= "A" && c <= "Z" || (c >= "0" && c <= "9" || (c === "_" || (c === "-" || (c === "." || c === "/")))));
};
var matchData = function(cs) {
  return function(i) {
    var run3 = takeWhile(isIdentChar2)(drop(i + 1 | 0)(cs));
    var v = migrateAtName(fromCharArray(run3));
    if (v instanceof Just) {
      return new Just(new Tuple(v.value0, 1 + length(run3) | 0));
    }
    ;
    if (v instanceof Nothing) {
      return Nothing.value;
    }
    ;
    throw new Error("Failed pattern match at Linter.Migrate (line 323, column 5 - line 325, column 25): " + [v.constructor.name]);
  };
};
var precededByBoundary = function(cs) {
  return function(i) {
    var v = index(cs)(i - 1 | 0);
    if (v instanceof Nothing) {
      return true;
    }
    ;
    if (v instanceof Just) {
      return !isIdentChar2(v.value0);
    }
    ;
    throw new Error("Failed pattern match at Linter.Migrate (line 308, column 27 - line 310, column 32): " + [v.constructor.name]);
  };
};
var isBareName = function(s) {
  return s !== "" && (!contains(" ")(s) && (!contains("	")(s) && !contains("(")(s)));
};
var firstWord = function(s) {
  var core = trim((function() {
    var $71 = take2(1)(s) === "~";
    if ($71) {
      return drop2(1)(s);
    }
    ;
    return s;
  })());
  var v = head(split(" ")(core));
  if (v instanceof Just) {
    return v.value0;
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 455, column 5 - line 457, column 20): " + [v.constructor.name]);
};
var isClauseSep = function(interior) {
  return elem14(firstWord(interior))(["else", "elif", "when"]);
};
var findFrom2 = function(cs) {
  return function(from2) {
    return function(pat) {
      var len = length(cs);
      var goF = function($copy_i) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i) {
          if (i > len) {
            $tco_done = true;
            return Nothing.value;
          }
          ;
          if (matchAt2(cs)(i)(pat)) {
            $tco_done = true;
            return new Just(i);
          }
          ;
          if (otherwise) {
            $copy_i = i + 1 | 0;
            return;
          }
          ;
          throw new Error("Failed pattern match at Linter.Migrate (line 579, column 3 - line 582, column 30): " + [i.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_i);
        }
        ;
        return $tco_result;
      };
      return goF(from2);
    };
  };
};
var scanSetDelimiters = function(src) {
  var cs = toCharArray(src);
  var len = length(cs);
  var go = function($copy_i) {
    return function($copy_acc) {
      var $tco_var_i = $copy_i;
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(i, acc) {
        if (i >= len) {
          $tco_done = true;
          return reverse(acc);
        }
        ;
        if (matchAt2(cs)(i)("{{=")) {
          var v = findFrom2(cs)(i + 3 | 0)("=}}");
          if (v instanceof Just) {
            var span2 = {
              start: i,
              end: v.value0 + 3 | 0
            };
            var body = slice2(i + 3 | 0)(v.value0)(src);
            $tco_var_i = v.value0 + 3 | 0;
            $copy_acc = cons({
              kind: "set-delimiters",
              span: span2,
              message: "Mustache set-delimiters directive `{{=" + (body + "=}}` is unsupported in MaxBars (delimiters are fixed `{{ }}` / `{{{ }}}`); the rest of the file was migrated under the default delimiters and may be wrong past this point."),
              suggestion: "Remove the set-delimiters directive and rewrite the affected tags to the standard `{{ }}` / `{{{ }}}` delimiters by hand."
            })(acc);
            return;
          }
          ;
          if (v instanceof Nothing) {
            $tco_var_i = i + 1 | 0;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at Linter.Migrate (line 544, column 9 - line 565, column 36): " + [v.constructor.name]);
        }
        ;
        if (otherwise) {
          $tco_var_i = i + 1 | 0;
          $copy_acc = acc;
          return;
        }
        ;
        throw new Error("Failed pattern match at Linter.Migrate (line 540, column 3 - line 540, column 48): " + [i.constructor.name, acc.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($tco_var_i, $copy_acc);
      }
      ;
      return $tco_result;
    };
  };
  return go(0)([]);
};
var emit = function(acc) {
  return function(s) {
    return {
      residuals: acc.residuals,
      stack: acc.stack,
      chunks: cons(s)(acc.chunks)
    };
  };
};
var charStr = singleton5;
var mapDataNames = function(s) {
  var scan = function($copy_i) {
    return function($copy_out) {
      return function($copy_cs) {
        var $tco_var_i = $copy_i;
        var $tco_var_out = $copy_out;
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i, out, cs) {
          var v = index(cs)(i);
          if (v instanceof Nothing) {
            $tco_done = true;
            return out;
          }
          ;
          if (v instanceof Just) {
            if (v.value0 === "@" && precededByBoundary(cs)(i)) {
              var v1 = matchData(cs)(i);
              if (v1 instanceof Just) {
                $tco_var_i = i + v1.value0.value1 | 0;
                $tco_var_out = cons(v1.value0.value0)(out);
                $copy_cs = cs;
                return;
              }
              ;
              if (v1 instanceof Nothing) {
                $tco_var_i = i + 1 | 0;
                $tco_var_out = cons(charStr(v.value0))(out);
                $copy_cs = cs;
                return;
              }
              ;
              throw new Error("Failed pattern match at Linter.Migrate (line 297, column 11 - line 300, column 68): " + [v1.constructor.name]);
            }
            ;
            if (otherwise) {
              $tco_var_i = i + 1 | 0;
              $tco_var_out = cons(charStr(v.value0))(out);
              $copy_cs = cs;
              return;
            }
            ;
          }
          ;
          throw new Error("Failed pattern match at Linter.Migrate (line 293, column 19 - line 301, column 66): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($tco_var_i, $tco_var_out, $copy_cs);
        }
        ;
        return $tco_result;
      };
    };
  };
  var go = function(v) {
    return function(out) {
      return function(cs) {
        return joinWith("")(reverse(scan(0)(out)(cs)));
      };
    };
  };
  return go(0)([])(toCharArray(s));
};
var mapDataInTag = mapDataNames;
var rewriteElseIf = function(interior) {
  var lead = take2(1)(interior) === "~";
  var afterLead = (function() {
    if (lead) {
      return drop2(1)(interior);
    }
    ;
    return interior;
  })();
  var trail = takeRight(1)(afterLead) === "~";
  var core = (function() {
    if (trail) {
      return dropRight(1)(afterLead);
    }
    ;
    return afterLead;
  })();
  var trimmed = trim(core);
  var v = stripPrefix("else if ")(trimmed);
  if (v instanceof Just) {
    return new Just("elif " + mapDataNames(trim(v.value0)));
  }
  ;
  if (v instanceof Nothing) {
    return Nothing.value;
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 404, column 5 - line 406, column 25): " + [v.constructor.name]);
};
var canonLoopHead = function(v) {
  if (v === "each") {
    return "for";
  }
  ;
  if (v === "with") {
    return "scope";
  }
  ;
  return v;
};
var renameInteriorHead = function(interior) {
  var tilde = take2(1)(interior) === "~";
  var lead = (function() {
    if (tilde) {
      return "~ ";
    }
    ;
    return "";
  })();
  var body = trim((function() {
    if (tilde) {
      return drop2(1)(interior);
    }
    ;
    return interior;
  })());
  var v = indexOf2(" ")(body);
  if (v instanceof Just) {
    return lead + (canonLoopHead(take2(v.value0)(body)) + drop2(v.value0)(body));
  }
  ;
  if (v instanceof Nothing) {
    return lead + canonLoopHead(body);
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 445, column 5 - line 447, column 44): " + [v.constructor.name]);
};
var ambiguousSection = function(span2) {
  return function(sigil) {
    return function(interior) {
      if (sigil instanceof Section) {
        var core = stripTildes(interior);
        var name2 = trim(core);
        var $95 = isBareName(name2) && !elem14(name2)(knownBlockHelpers);
        if ($95) {
          return [{
            kind: "ambiguous-section",
            span: span2,
            message: "bare Mustache section `{{#" + (name2 + ("}}` is ambiguous in MaxBars: a " + ("Handlebars `{{#" + (name2 + ("}}` renders its body when truthy AND " + ("iterates when `" + (name2 + ("` is a list \u2014 MaxBars splits these into " + ("`{{#if " + (name2 + ("}}` and `{{#each " + (name2 + "}}`.")))))))))))),
            suggestion: "Choose the intended form: `{{#if " + (name2 + ("}}\u2026{{/if}}` for a truthy " + ("guard, or `{{#each " + (name2 + "}}\u2026{{/each}}` to iterate a list."))))
          }];
        }
        ;
        return [];
      }
      ;
      return [];
    };
  };
};
var openResiduals = function(span2) {
  return function(sigil) {
    return function(interior) {
      return ambiguousSection(span2)(sigil)(interior);
    };
  };
};
var addResiduals = function(acc) {
  return function(rs) {
    return {
      chunks: acc.chunks,
      stack: acc.stack,
      residuals: foldl2(flip(cons))(acc.residuals)(rs)
    };
  };
};
var step = function(src) {
  return function(acc) {
    return function(v) {
      if (v instanceof RContent) {
        return emit(acc)(v.value1);
      }
      ;
      if (v instanceof ROutput) {
        return emit(acc)("{{ " + (mapDataNames(v.value2) + " | safe }}"));
      }
      ;
      if (v instanceof RAmp) {
        return emit(acc)("{{ " + (mapDataNames(v.value2) + " | safe }}"));
      }
      ;
      if (v instanceof ROpen) {
        var tr = trimsOf(sliceSpan(src)(v.value0));
        var acc1 = addResiduals(acc)(openResiduals(v.value0)(v.value1)(v.value3));
        if (v.value1 instanceof Inverse) {
          return push2(emit(acc1)(stmtTag(tr)("unless " + mapDataNames(v.value3))))(CloseUnless.value);
        }
        ;
        if (v.value1 instanceof PartialBlock) {
          return push2(emit(acc1)(stmtTag(tr)(quoteHead("partial")(mapDataNames(v.value3)))))(ClosePartial.value);
        }
        ;
        return push2(emit(acc1)(stmtTag(tr)(renameInteriorHead(mapDataNames(v.value3)))))(CloseEnd.value);
      }
      ;
      if (v instanceof RClose) {
        var tr = trimsOf(sliceSpan(src)(v.value0));
        var v1 = head(acc.stack);
        if (v1 instanceof Just && v1.value0 instanceof CloseUnless) {
          return emit(popStack(acc))(stmtTag(tr)("endunless"));
        }
        ;
        if (v1 instanceof Just && v1.value0 instanceof ClosePartial) {
          return emit(popStack(acc))(stmtTag(tr)("endpartial"));
        }
        ;
        return emit(popStack(acc))(stmtTag(tr)("end" + canonLoopHead(v.value2)));
      }
      ;
      if (v instanceof RSep) {
        var tr = trimsOf(sliceSpan(src)(v.value0));
        var v1 = rewriteElseIf(v.value2);
        if (v1 instanceof Just) {
          return emit(acc)(stmtTag(tr)(v1.value0));
        }
        ;
        if (v1 instanceof Nothing && isPartialBlockRef(v.value2)) {
          return emit(acc)(stmtTag(tr)("yield"));
        }
        ;
        var v2 = function(v3) {
          if (v1 instanceof Nothing) {
            if (isClauseSep(v.value2)) {
              return emit(acc)(stmtTag(tr)(mapDataNames(v.value2)));
            }
            ;
            if (otherwise) {
              return emit(acc)(mapDataInTag(sliceSpan(src)(v.value0)));
            }
            ;
          }
          ;
          throw new Error("Failed pattern match at Linter.Migrate (line 140, column 1 - line 140, column 39): " + [v1.constructor.name]);
        };
        if (v1 instanceof Nothing) {
          var $124 = partialInclude(v.value2);
          if ($124 instanceof Just) {
            return emit(acc)(stmtTag(tr)($124.value0));
          }
          ;
          return v2(true);
        }
        ;
        return v2(true);
      }
      ;
      if (v instanceof RComment) {
        return emit(acc)(sliceSpan(src)(v.value0));
      }
      ;
      if (v instanceof RRaw) {
        return emit(acc)(sliceSpan(src)(v.value0));
      }
      ;
      if (v instanceof RSetDelim) {
        return emit(acc)(sliceSpan(src)(v.value0));
      }
      ;
      if (v instanceof RLongComment) {
        return emit(acc)(sliceSpan(src)(v.value0));
      }
      ;
      if (v instanceof RError) {
        return emit(acc)(sliceSpan(src)(v.value0));
      }
      ;
      throw new Error("Failed pattern match at Linter.Migrate (line 141, column 16 - line 221, column 49): " + [v.constructor.name]);
    };
  };
};
var rewrite2 = function(src) {
  return function(toks) {
    var $$final = foldl2(step(src))({
      chunks: [],
      residuals: [],
      stack: []
    })(toks);
    return {
      source: joinWith("")(reverse($$final.chunks)),
      residuals: reverse($$final.residuals)
    };
  };
};
var migrateToMaxBars = function(src) {
  return bind10(tokenizeTemplate(defaultLexConfig)(src))(function(toks) {
    var walk3 = rewrite2(src)(toks);
    var delimResiduals = scanSetDelimiters(src);
    return pure11({
      source: walk3.source,
      residuals: append17(delimResiduals)(walk3.residuals)
    });
  });
};

// output/Kernel.Schema/index.js
var $runtime_lazy7 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var union10 = /* @__PURE__ */ union7(ordString);
var fromFoldable13 = /* @__PURE__ */ fromFoldable7(foldableArray)(ordString);
var foldl6 = /* @__PURE__ */ foldl(foldableArray);
var map28 = /* @__PURE__ */ map(functorArray);
var toUnfoldable10 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var fromFoldable14 = /* @__PURE__ */ fromFoldable(foldableSet);
var member6 = /* @__PURE__ */ member4(ordString);
var lookup11 = /* @__PURE__ */ lookup2(ordString);
var append18 = /* @__PURE__ */ append(semigroupArray);
var bind11 = /* @__PURE__ */ bind(bindMaybe);
var pure12 = /* @__PURE__ */ pure(applicativeMaybe);
var compare3 = /* @__PURE__ */ compare(ordString);
var eqMap3 = /* @__PURE__ */ eqMap(eqString);
var eqSet2 = /* @__PURE__ */ eqSet(eqString);
var insert9 = /* @__PURE__ */ insert(ordString);
var toUnfoldable12 = /* @__PURE__ */ toUnfoldable6(unfoldableArray);
var fromFoldable22 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var show15 = /* @__PURE__ */ show(showInt);
var union1 = /* @__PURE__ */ union(ordString);
var insertWith2 = /* @__PURE__ */ insertWith(ordString);
var map112 = /* @__PURE__ */ map(functorMaybe);
var insert1 = /* @__PURE__ */ insert8(ordString);
var SKey = /* @__PURE__ */ (function() {
  function SKey2(value0) {
    this.value0 = value0;
  }
  ;
  SKey2.create = function(value0) {
    return new SKey2(value0);
  };
  return SKey2;
})();
var SElem = /* @__PURE__ */ (function() {
  function SElem2() {
  }
  ;
  SElem2.value = new SElem2();
  return SElem2;
})();
var SUnknown = /* @__PURE__ */ (function() {
  function SUnknown2() {
  }
  ;
  SUnknown2.value = new SUnknown2();
  return SUnknown2;
})();
var SString = /* @__PURE__ */ (function() {
  function SString2() {
  }
  ;
  SString2.value = new SString2();
  return SString2;
})();
var SNumber = /* @__PURE__ */ (function() {
  function SNumber2() {
  }
  ;
  SNumber2.value = new SNumber2();
  return SNumber2;
})();
var SBool = /* @__PURE__ */ (function() {
  function SBool2() {
  }
  ;
  SBool2.value = new SBool2();
  return SBool2;
})();
var SConflict = /* @__PURE__ */ (function() {
  function SConflict2() {
  }
  ;
  SConflict2.value = new SConflict2();
  return SConflict2;
})();
var TyScalar = /* @__PURE__ */ (function() {
  function TyScalar2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  TyScalar2.create = function(value0) {
    return function(value1) {
      return new TyScalar2(value0, value1);
    };
  };
  return TyScalar2;
})();
var TyArray = /* @__PURE__ */ (function() {
  function TyArray2(value0) {
    this.value0 = value0;
  }
  ;
  TyArray2.create = function(value0) {
    return new TyArray2(value0);
  };
  return TyArray2;
})();
var TyMap = /* @__PURE__ */ (function() {
  function TyMap2(value0) {
    this.value0 = value0;
  }
  ;
  TyMap2.create = function(value0) {
    return new TyMap2(value0);
  };
  return TyMap2;
})();
var TyObject = /* @__PURE__ */ (function() {
  function TyObject2(value0) {
    this.value0 = value0;
  }
  ;
  TyObject2.create = function(value0) {
    return new TyObject2(value0);
  };
  return TyObject2;
})();
var TyEnum = /* @__PURE__ */ (function() {
  function TyEnum2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  TyEnum2.create = function(value0) {
    return function(value1) {
      return new TyEnum2(value0, value1);
    };
  };
  return TyEnum2;
})();
var TyUnknown = /* @__PURE__ */ (function() {
  function TyUnknown2() {
  }
  ;
  TyUnknown2.value = new TyUnknown2();
  return TyUnknown2;
})();
var whenLiterals = /* @__PURE__ */ (function() {
  var litStr = function(v) {
    if (v instanceof Lit && v.value0 instanceof VString) {
      return new Just(v.value0.value0);
    }
    ;
    return Nothing.value;
  };
  var go = function(s) {
    return function(v) {
      if (v instanceof Sep && v.value1 === "when") {
        return union10(s)(fromFoldable13(mapMaybe(litStr)(v.value2)));
      }
      ;
      return s;
    };
  };
  return foldl6(go)(empty3);
})();
var structName = function(field) {
  var cap = function(s) {
    var v = uncons2(s);
    if (v instanceof Just) {
      return toUpper(singleton5(v.value0.head)) + v.value0.tail;
    }
    ;
    if (v instanceof Nothing) {
      return s;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Schema (line 649, column 11 - line 651, column 17): " + [v.constructor.name]);
  };
  var base = (function() {
    var $222 = length3(field) > 1 && takeRight(1)(field) === "s";
    if ($222) {
      return dropRight(1)(field);
    }
    ;
    return field;
  })();
  return cap(base);
};
var stringPack = /* @__PURE__ */ fromFoldable13(["uppercase", "lowercase", "capitalize", "trim", "trimStart", "trimEnd", "append", "prepend", "concat", "replace", "split", "startsWith", "endsWith", "includes", "slice", "truncate", "reverse"]);
var segKeyName = function(v) {
  if (v instanceof SKey) {
    return new Just(v.value0);
  }
  ;
  return Nothing.value;
};
var scalarRust = function(v) {
  if (v instanceof SString) {
    return "String";
  }
  ;
  if (v instanceof SNumber) {
    return "f64";
  }
  ;
  if (v instanceof SBool) {
    return "bool";
  }
  ;
  if (v instanceof SUnknown) {
    return "String";
  }
  ;
  if (v instanceof SConflict) {
    return "String";
  }
  ;
  throw new Error("Failed pattern match at Kernel.Schema (line 632, column 14 - line 637, column 24): " + [v.constructor.name]);
};
var scaffoldJson = function(v) {
  if (v instanceof TyScalar) {
    if (v.value1) {
      return "null";
    }
    ;
    if (otherwise) {
      if (v.value0 instanceof SNumber) {
        return "0";
      }
      ;
      if (v.value0 instanceof SBool) {
        return "false";
      }
      ;
      return '""';
    }
    ;
  }
  ;
  if (v instanceof TyArray) {
    return "[ " + (scaffoldJson(v.value0) + " ]");
  }
  ;
  if (v instanceof TyMap) {
    return '{ "key": ' + (scaffoldJson(v.value0) + " }");
  }
  ;
  if (v instanceof TyObject) {
    return "{ " + (joinWith(", ")(map28(function(v1) {
      return '"' + (v1.value0 + ('": ' + scaffoldJson(v1.value1)));
    })(toUnfoldable10(v.value0))) + " }");
  }
  ;
  if (v instanceof TyEnum) {
    return '{ "' + (v.value0 + ('": "' + (fromMaybe("")(head(fromFoldable14(v.value1))) + '" }')));
  }
  ;
  if (v instanceof TyUnknown) {
    return '""';
  }
  ;
  throw new Error("Failed pattern match at Kernel.Schema (line 724, column 16 - line 741, column 22): " + [v.constructor.name]);
};
var rootScope = {
  current: [],
  parents: [],
  binds: empty2,
  shadowed: empty3,
  partials: empty2,
  visiting: empty3
};
var reserved = /* @__PURE__ */ fromFoldable13(["loop", "index", "index0", "index1", "rindex0", "rindex1", "first", "last", "length", "key", "yield", "true", "false", "null", "this", "root", "parent", "outer"]);
var resolveHead = function(sc) {
  return function(name2) {
    if (name2 === "this") {
      return new Just(sc.current);
    }
    ;
    if (name2 === "root") {
      return new Just([]);
    }
    ;
    if (name2 === "parent" || name2 === "@parentchain") {
      return head(sc.parents);
    }
    ;
    if (take3(1)(name2) === "@") {
      return Nothing.value;
    }
    ;
    if (member6(name2)(reserved)) {
      return Nothing.value;
    }
    ;
    if (member6(name2)(sc.shadowed)) {
      return Nothing.value;
    }
    ;
    if (otherwise) {
      var v = lookup11(name2)(sc.binds);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        return new Just(append18(sc.current)([new SKey(name2)]));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 180, column 17 - line 182, column 52): " + [v.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at Kernel.Schema (line 171, column 1 - line 171, column 46): " + [sc.constructor.name, name2.constructor.name]);
  };
};
var observeStr = function(canon) {
  return function(v) {
    if (v instanceof VString) {
      return [new Tuple(canon, v.value0)];
    }
    ;
    if (v instanceof VSafe) {
      return [new Tuple(canon, v.value0)];
    }
    ;
    if (v instanceof VArray) {
      return concatMap(observeStr(snoc(canon)(SElem.value)))(v.value0);
    }
    ;
    if (v instanceof VObject) {
      return concatMap(function(v1) {
        return observeStr(snoc(canon)(new SKey(v1.value0)))(v1.value1);
      })(toUnfoldable10(v.value0));
    }
    ;
    return [];
  };
};
var observe = function(canon) {
  return function(v) {
    if (v instanceof VString) {
      return [new Tuple(canon, SString.value)];
    }
    ;
    if (v instanceof VSafe) {
      return [new Tuple(canon, SString.value)];
    }
    ;
    if (v instanceof VNumber) {
      return [new Tuple(canon, SNumber.value)];
    }
    ;
    if (v instanceof VBool) {
      return [new Tuple(canon, SBool.value)];
    }
    ;
    if (v instanceof VNull) {
      return [];
    }
    ;
    if (v instanceof VArray) {
      return concatMap(observe(snoc(canon)(SElem.value)))(v.value0);
    }
    ;
    if (v instanceof VObject) {
      return concatMap(function(v1) {
        return observe(snoc(canon)(new SKey(v1.value0)))(v1.value1);
      })(toUnfoldable10(v.value0));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Schema (line 792, column 17 - line 801, column 57): " + [v.constructor.name]);
  };
};
var numberPack = /* @__PURE__ */ fromFoldable13(["add", "subtract", "multiply", "divide", "modulo", "even", "odd", "divisibleBy", "abs", "ceil", "floor", "round", "toFixed", "toFloat", "toInt", "lt", "gt", "lte", "gte"]);
var isKeyLit = function(v) {
  if (v instanceof Lit && (v.value0 instanceof VString && v.value0.value0 === "key")) {
    return true;
  }
  ;
  return false;
};
var mentionsKeyE = function(v) {
  if (v instanceof App2 && (v.value0 === "key" && v.value1.length === 0)) {
    return true;
  }
  ;
  if (v instanceof App2 && v.value0 === "lookup") {
    var v1 = head(v.value1);
    if (v1 instanceof Just && (v1.value0 instanceof App2 && (v1.value0.value0 === "loop" && v1.value0.value1.length === 0))) {
      return any2(isKeyLit)(fromMaybe([])(tail(v.value1)));
    }
    ;
    if (v1 instanceof Just && (v1.value0 instanceof App2 && (v1.value0.value0 === "key" && v1.value0.value1.length === 0))) {
      return true;
    }
    ;
    return any2(mentionsKeyE)(v.value1);
  }
  ;
  if (v instanceof App2) {
    return any2(mentionsKeyE)(v.value1);
  }
  ;
  if (v instanceof Lit) {
    return false;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Schema (line 527, column 16 - line 534, column 17): " + [v.constructor.name]);
};
var $lazy_mentionsKey = /* @__PURE__ */ $runtime_lazy7("mentionsKey", "Kernel.Schema", function() {
  var nodeKey = function(v) {
    if (v instanceof Output) {
      return mentionsKeyE(v.value1);
    }
    ;
    if (v instanceof Sep) {
      return any2(mentionsKeyE)(v.value2);
    }
    ;
    if (v instanceof Block) {
      return any2(mentionsKeyE)(v.value3) || $lazy_mentionsKey(523)(v.value4);
    }
    ;
    return false;
  };
  return any2(nodeKey);
});
var mentionsKey = /* @__PURE__ */ $lazy_mentionsKey(517);
var hashPairs = /* @__PURE__ */ (function() {
  var pairUp = function(ys) {
    var v = uncons(ys);
    if (v instanceof Just && (v.value0.head instanceof Lit && v.value0.head.value0 instanceof VString)) {
      var v1 = uncons(v.value0.tail);
      if (v1 instanceof Just) {
        return cons(new Tuple(v.value0.head.value0.value0, v1.value0.head))(pairUp(v1.value0.tail));
      }
      ;
      if (v1 instanceof Nothing) {
        return [];
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 549, column 45 - line 551, column 20): " + [v1.constructor.name]);
    }
    ;
    return [];
  };
  return function(v) {
    if (v instanceof Just && (v.value0 instanceof App2 && v.value0.value0 === "dict")) {
      return pairUp(v.value0.value1);
    }
    ;
    return [];
  };
})();
var hasElse = /* @__PURE__ */ (function() {
  var isElse = function(v) {
    if (v instanceof Sep) {
      return v.value1 === "else" || v.value1 === "elif";
    }
    ;
    return false;
  };
  return any2(isElse);
})();
var filterPack = /* @__PURE__ */ fromFoldable13(["where", "reject", "find", "some", "every", "pluck", "sortBy", "groupBy"]);
var exprCanon = function(sc) {
  var step2 = function(e) {
    return function(acc) {
      if (e instanceof Lit && (e.value0 instanceof VString && acc instanceof Just)) {
        return new Just(cons(new SKey(e.value0.value0))(acc.value0));
      }
      ;
      return Nothing.value;
    };
  };
  var traverseKeys = foldr2(step2)(new Just([]));
  var recvCanon = function(v) {
    if (v instanceof App2 && v.value1.length === 0) {
      return resolveHead(sc)(v.value0);
    }
    ;
    return exprCanon(sc)(v);
  };
  return function(v) {
    if (v instanceof App2 && v.value0 === "lookup") {
      var v1 = uncons(v.value1);
      if (v1 instanceof Just && (v1.value0.head instanceof App2 && (v1.value0.head.value0 === "this" && (v1.value0.head.value1.length === 0 && (v1.value0.tail.length === 1 && (v1["value0"]["tail"][0] instanceof Lit && (v1["value0"]["tail"][0].value0 instanceof VString && member6(v1["value0"]["tail"][0].value0.value0)(sc.shadowed)))))))) {
        return Nothing.value;
      }
      ;
      if (v1 instanceof Just) {
        return bind11(recvCanon(v1.value0.head))(function(base) {
          return bind11(traverseKeys(v1.value0.tail))(function(ks) {
            return pure12(append18(base)(ks));
          });
        });
      }
      ;
      if (v1 instanceof Nothing) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 187, column 24 - line 199, column 23): " + [v1.constructor.name]);
    }
    ;
    if (v instanceof App2 && v.value1.length === 0) {
      return resolveHead(sc)(v.value0);
    }
    ;
    return Nothing.value;
  };
};
var eqSeg = {
  eq: function(x) {
    return function(y) {
      if (x instanceof SKey && y instanceof SKey) {
        return x.value0 === y.value0;
      }
      ;
      if (x instanceof SElem && y instanceof SElem) {
        return true;
      }
      ;
      return false;
    };
  }
};
var eqArray2 = /* @__PURE__ */ eqArray(eqSeg);
var eq33 = /* @__PURE__ */ eq(eqArray2);
var elem15 = /* @__PURE__ */ elem2(eqSeg);
var ordSeg = {
  compare: function(x) {
    return function(y) {
      if (x instanceof SKey && y instanceof SKey) {
        return compare3(x.value0)(y.value0);
      }
      ;
      if (x instanceof SKey) {
        return LT.value;
      }
      ;
      if (y instanceof SKey) {
        return GT.value;
      }
      ;
      if (x instanceof SElem && y instanceof SElem) {
        return EQ.value;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 0, column 0 - line 0, column 0): " + [x.constructor.name, y.constructor.name]);
    };
  },
  Eq0: function() {
    return eqSeg;
  }
};
var nub4 = /* @__PURE__ */ nub(ordSeg);
var eqScalarHint = {
  eq: function(x) {
    return function(y) {
      if (x instanceof SUnknown && y instanceof SUnknown) {
        return true;
      }
      ;
      if (x instanceof SString && y instanceof SString) {
        return true;
      }
      ;
      if (x instanceof SNumber && y instanceof SNumber) {
        return true;
      }
      ;
      if (x instanceof SBool && y instanceof SBool) {
        return true;
      }
      ;
      if (x instanceof SConflict && y instanceof SConflict) {
        return true;
      }
      ;
      return false;
    };
  }
};
var eq42 = /* @__PURE__ */ eq(eqScalarHint);
var eq5 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMap3(/* @__PURE__ */ eqTuple(eqArray2)(/* @__PURE__ */ eqRec()(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(/* @__PURE__ */ eqRowCons(eqRowNil)()({
  reflectSymbol: function() {
    return "scalar";
  }
})(eqScalarHint))()({
  reflectSymbol: function() {
    return "optional";
  }
})(eqBoolean))()({
  reflectSymbol: function() {
    return "isMap";
  }
})(eqBoolean))()({
  reflectSymbol: function() {
    return "isArray";
  }
})(eqBoolean))()({
  reflectSymbol: function() {
    return "fields";
  }
})(eqSet2))()({
  reflectSymbol: function() {
    return "enumVariants";
  }
})(eqSet2))()({
  reflectSymbol: function() {
    return "enumTag";
  }
})(/* @__PURE__ */ eqMaybe(eqString)))()({
  reflectSymbol: function() {
    return "coupled";
  }
})(eqSet2)))));
var propagateCouples = function($copy_cs) {
  var $tco_done = false;
  var $tco_result;
  function $tco_loop(cs) {
    var pushTo = function(hint) {
      return function(acc) {
        return function(coupledKey) {
          var v = lookup11(coupledKey)(acc);
          if (v instanceof Just && eq42(v.value0.value1.scalar)(SUnknown.value)) {
            return insert9(coupledKey)(new Tuple(v.value0.value0, {
              coupled: v.value0.value1.coupled,
              enumTag: v.value0.value1.enumTag,
              enumVariants: v.value0.value1.enumVariants,
              fields: v.value0.value1.fields,
              isArray: v.value0.value1.isArray,
              isMap: v.value0.value1.isMap,
              optional: v.value0.value1.optional,
              scalar: hint
            }))(acc);
          }
          ;
          return acc;
        };
      };
    };
    var push4 = function(acc) {
      return function(v) {
        var $366 = eq42(v.value1.value1.scalar)(SUnknown.value);
        if ($366) {
          return acc;
        }
        ;
        return foldl6(pushTo(v.value1.value1.scalar))(acc)(toUnfoldable12(v.value1.value1.coupled));
      };
    };
    var onePass = function(m) {
      return foldl6(push4)(m)(toUnfoldable10(m));
    };
    var cs$prime = onePass(cs);
    var $371 = eq5(cs$prime)(cs);
    if ($371) {
      $tco_done = true;
      return cs;
    }
    ;
    $copy_cs = cs$prime;
    return;
  }
  ;
  while (!$tco_done) {
    $tco_result = $tco_loop($copy_cs);
  }
  ;
  return $tco_result;
};
var refineScalars = function(obs) {
  return function(cs) {
    var ref = function(v) {
      var v1 = lookup11(v.value0)(obs);
      if (v1 instanceof Just && eq42(v.value1.value1.scalar)(SUnknown.value)) {
        return new Tuple(v.value0, new Tuple(v.value1.value0, {
          coupled: v.value1.value1.coupled,
          enumTag: v.value1.value1.enumTag,
          enumVariants: v.value1.value1.enumVariants,
          fields: v.value1.value1.fields,
          isArray: v.value1.value1.isArray,
          isMap: v.value1.value1.isMap,
          optional: v.value1.value1.optional,
          scalar: v1.value0
        }));
      }
      ;
      return new Tuple(v.value0, new Tuple(v.value1.value0, v.value1.value1));
    };
    return fromFoldable22(map28(ref)(toUnfoldable10(cs)));
  };
};
var unifyScalar = function(v) {
  return function(v1) {
    if (v instanceof SUnknown) {
      return v1;
    }
    ;
    if (v1 instanceof SUnknown) {
      return v;
    }
    ;
    if (v instanceof SConflict) {
      return SConflict.value;
    }
    ;
    if (v1 instanceof SConflict) {
      return SConflict.value;
    }
    ;
    if (eq42(v)(v1)) {
      return v;
    }
    ;
    if (otherwise) {
      return SConflict.value;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Schema (line 72, column 1 - line 72, column 54): " + [v.constructor.name, v1.constructor.name]);
  };
};
var mergeC = function(a) {
  return function(b) {
    return {
      isArray: a.isArray || b.isArray,
      isMap: a.isMap || b.isMap,
      fields: union10(a.fields)(b.fields),
      scalar: unifyScalar(a.scalar)(b.scalar),
      optional: a.optional || b.optional,
      enumTag: maybe(b.enumTag)(Just.create)(a.enumTag),
      enumVariants: union10(a.enumVariants)(b.enumVariants),
      coupled: union10(a.coupled)(b.coupled)
    };
  };
};
var emptyC = /* @__PURE__ */ (function() {
  return {
    isArray: false,
    isMap: false,
    fields: empty3,
    scalar: SUnknown.value,
    optional: false,
    enumTag: Nothing.value,
    enumVariants: empty3,
    coupled: empty3
  };
})();
var emitSchema = function(root) {
  var wrapOpt = function(opt) {
    return function(s) {
      if (opt) {
        return "Option<" + (s + ">");
      }
      ;
      return s;
    };
  };
  var cap1 = function(s) {
    var v = uncons2(s);
    if (v instanceof Just) {
      return toUpper(singleton5(v.value0.head)) + v.value0.tail;
    }
    ;
    if (v instanceof Nothing) {
      return s;
    }
    ;
    throw new Error("Failed pattern match at Kernel.Schema (line 718, column 12 - line 720, column 17): " + [v.constructor.name]);
  };
  var enumDecl = function(nm) {
    return function(tag) {
      return function(vars) {
        return '#[derive(serde::Deserialize, trussbars_core::Trussbars)]\n#[serde(tag = "' + (tag + ('")]\nenum ' + (nm + (" { " + (joinWith(", ")(map28(cap1)(fromFoldable14(vars))) + " }")))));
      };
    };
  };
  var tyRef = function(field) {
    return function(v) {
      if (v instanceof TyScalar) {
        return wrapOpt(v.value1)(scalarRust(v.value0));
      }
      ;
      if (v instanceof TyArray && v.value0 instanceof TyObject) {
        return "Vec<" + (structName(field) + ">");
      }
      ;
      if (v instanceof TyArray && v.value0 instanceof TyEnum) {
        return "Vec<" + (structName(field) + ">");
      }
      ;
      if (v instanceof TyArray) {
        return "Vec<" + (tyRef(field)(v.value0) + ">");
      }
      ;
      if (v instanceof TyMap) {
        return "BTreeMap<String, " + (tyRef(field)(v.value0) + ">");
      }
      ;
      if (v instanceof TyObject) {
        return cap1(field);
      }
      ;
      if (v instanceof TyEnum) {
        return cap1(field);
      }
      ;
      if (v instanceof TyUnknown) {
        return "String";
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 707, column 17 - line 715, column 26): " + [v.constructor.name]);
    };
  };
  var objBody = function(v) {
    return function(v1) {
      if (v1 instanceof TyObject) {
        return "{ " + (joinWith(", ")(map28(function(v2) {
          return v2.value0 + (": " + tyRef(v2.value0)(v2.value1));
        })(toUnfoldable10(v1.value0))) + " }");
      }
      ;
      return "{ /* \u2026 */ }";
    };
  };
  var namedFor = function(k) {
    return function(v) {
      if (v instanceof TyArray && v.value0 instanceof TyObject) {
        return ["#[derive(serde::Deserialize, trussbars_core::Trussbars)]\nstruct " + (structName(k) + (" " + objBody(structName(k))(new TyObject(v.value0.value0))))];
      }
      ;
      if (v instanceof TyArray && v.value0 instanceof TyEnum) {
        return [enumDecl(structName(k))(v.value0.value0)(v.value0.value1)];
      }
      ;
      if (v instanceof TyObject) {
        return ["#[derive(serde::Deserialize, trussbars_core::Trussbars)]\nstruct " + (cap1(k) + (" " + objBody(cap1(k))(new TyObject(v.value0))))];
      }
      ;
      if (v instanceof TyEnum) {
        return [enumDecl(cap1(k))(v.value0)(v.value1)];
      }
      ;
      return [];
    };
  };
  var collect2 = function(v) {
    if (v instanceof TyObject) {
      return concatMap(function(v1) {
        return append18(namedFor(v1.value0)(v1.value1))(collect2(v1.value1));
      })(toUnfoldable10(v.value0));
    }
    ;
    if (v instanceof TyArray) {
      return collect2(v.value0);
    }
    ;
    if (v instanceof TyMap) {
      return collect2(v.value0);
    }
    ;
    return [];
  };
  var structDecls = collect2(root);
  var rootDecl = "#[derive(serde::Deserialize, trussbars_core::Trussbars)]\nstruct Ctx " + objBody("Ctx")(root);
  return joinWith("\n\n")(append18([rootDecl])(structDecls));
};
var countGuessed = function(v) {
  if (v instanceof TyScalar && v.value0 instanceof SUnknown) {
    return 1;
  }
  ;
  if (v instanceof TyScalar) {
    return 0;
  }
  ;
  if (v instanceof TyArray) {
    return countGuessed(v.value0);
  }
  ;
  if (v instanceof TyMap) {
    return countGuessed(v.value0);
  }
  ;
  if (v instanceof TyObject) {
    return foldl6(function(n) {
      return function(v1) {
        return n + countGuessed(v1.value1) | 0;
      };
    })(0)(toUnfoldable10(v.value0));
  }
  ;
  if (v instanceof TyEnum) {
    return 0;
  }
  ;
  if (v instanceof TyUnknown) {
    return 0;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Schema (line 757, column 16 - line 765, column 17): " + [v.constructor.name]);
};
var countConflicts = function(v) {
  if (v instanceof TyScalar && v.value0 instanceof SConflict) {
    return 1;
  }
  ;
  if (v instanceof TyScalar) {
    return 0;
  }
  ;
  if (v instanceof TyArray) {
    return countConflicts(v.value0);
  }
  ;
  if (v instanceof TyMap) {
    return countConflicts(v.value0);
  }
  ;
  if (v instanceof TyObject) {
    return foldl6(function(n) {
      return function(v1) {
        return n + countConflicts(v1.value1) | 0;
      };
    })(0)(toUnfoldable10(v.value0));
  }
  ;
  if (v instanceof TyEnum) {
    return 0;
  }
  ;
  if (v instanceof TyUnknown) {
    return 0;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Schema (line 745, column 18 - line 753, column 17): " + [v.constructor.name]);
};
var emitReport = function(root) {
  var guessed = countGuessed(root);
  var conflicts = countConflicts(root);
  return joinWith("\n")(["# Schema inference (template-symbolic)", show15(guessed) + (" field(s) defaulted to `String` (bare output \u2014 provide --data to refine), " + (show15(conflicts) + " conflict(s).")), (function() {
    var $446 = conflicts > 0;
    if ($446) {
      return "\u26A0 conflicts present \u2014 a path is used at two incompatible types; rerun with --strict to fail.";
    }
    ;
    return "";
  })(), (function() {
    var $447 = guessed > 0;
    if ($447) {
      return "Defaulted fields are a guess, not a deduction \u2014 confirm or narrow them.";
    }
    ;
    return "";
  })()]);
};
var comparePack = /* @__PURE__ */ fromFoldable13(["eq", "ne", "isnt"]);
var $lazy_collectInlines = /* @__PURE__ */ $runtime_lazy7("collectInlines", "Kernel.Schema", function() {
  var go = function(m) {
    return function(v) {
      if (v instanceof Block && v.value2 === "inline") {
        var m$prime = union1($lazy_collectInlines(903)(v.value4))(m);
        var v1 = head(splitBlockArgs(v.value3).positional);
        if (v1 instanceof Just && (v1.value0 instanceof Lit && v1.value0.value0 instanceof VString)) {
          return insert9(v1.value0.value0.value0)(v.value4)(m$prime);
        }
        ;
        return m$prime;
      }
      ;
      if (v instanceof Block) {
        return union1($lazy_collectInlines(908)(v.value4))(m);
      }
      ;
      return m;
    };
  };
  return foldl6(go)(empty2);
});
var collectInlines = /* @__PURE__ */ $lazy_collectInlines(897);
var canonKey = /* @__PURE__ */ (function() {
  var segKey2 = function(v) {
    if (v instanceof SKey) {
      return "k:" + v.value0;
    }
    ;
    if (v instanceof SElem) {
      return "[]";
    }
    ;
    throw new Error("Failed pattern match at Kernel.Schema (line 54, column 12 - line 56, column 18): " + [v.constructor.name]);
  };
  var $619 = joinWith("");
  var $620 = map28(segKey2);
  return function($621) {
    return $619($620($621));
  };
})();
var observeScalars = /* @__PURE__ */ (function() {
  var addObs = function(m) {
    return function(v) {
      return insertWith2(unifyScalar)(canonKey(v.value0))(v.value1)(m);
    };
  };
  var addSample = function(m) {
    return function(s) {
      return foldl6(addObs)(m)(observe([])(s));
    };
  };
  return foldl6(addSample)(empty2);
})();
var observeTags = /* @__PURE__ */ (function() {
  var addV = function(m) {
    return function(v) {
      return insertWith2(union10)(canonKey(v.value0))(singleton8(v.value1))(m);
    };
  };
  var addSample = function(m) {
    return function(s) {
      return foldl6(addV)(m)(observeStr([])(s));
    };
  };
  return foldl6(addSample)(empty2);
})();
var record = function(canon) {
  return function(c) {
    return insertWith2(function(v) {
      return function(v1) {
        return new Tuple(v.value0, mergeC(v.value1)(v1.value1));
      };
    })(canonKey(canon))(new Tuple(canon, c));
  };
};
var refineEnums = function(obs) {
  return function(cs) {
    var ref = function(v) {
      if (v.value1.value1.enumTag instanceof Just) {
        var dataVars2 = fromMaybe(empty3)(lookup11(canonKey(append18(v.value1.value0)([new SKey(v.value1.value1.enumTag.value0)])))(obs));
        return new Tuple(v.value0, new Tuple(v.value1.value0, {
          enumTag: v.value1.value1.enumTag,
          coupled: v.value1.value1.coupled,
          fields: v.value1.value1.fields,
          isArray: v.value1.value1.isArray,
          isMap: v.value1.value1.isMap,
          optional: v.value1.value1.optional,
          scalar: v.value1.value1.scalar,
          enumVariants: union10(v.value1.value1.enumVariants)(dataVars2)
        }));
      }
      ;
      if (v.value1.value1.enumTag instanceof Nothing) {
        return new Tuple(v.value0, new Tuple(v.value1.value0, v.value1.value1));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 834, column 37 - line 840, column 41): " + [v.value1.value1.enumTag.constructor.name]);
    };
    return fromFoldable22(map28(ref)(toUnfoldable10(cs)));
  };
};
var buildTy = function(obs) {
  return function(cs) {
    var entries = map28(snd)(toUnfoldable10(cs));
    var exact = function(p) {
      return map112(snd)(find2(function(v) {
        return canonKey(v.value0) === canonKey(p);
      })(entries));
    };
    var childrenOf = function(prefix) {
      var n = length(prefix);
      var nextSeg = function(v) {
        var $490 = eq33(take(n)(v.value0))(prefix) && length(v.value0) > n;
        if ($490) {
          return index(v.value0)(n);
        }
        ;
        return Nothing.value;
      };
      return nub4(mapMaybe(nextSeg)(entries));
    };
    var atPrefix = function(prefix) {
      var kids = childrenOf(prefix);
      var keyKids = mapMaybe(segKeyName)(kids);
      var hasElem = elem15(SElem.value)(kids);
      var c = fromMaybe(emptyC)(exact(prefix));
      if (c.enumTag instanceof Just) {
        return new TyEnum(c.enumTag.value0, c.enumVariants);
      }
      ;
      if (c.enumTag instanceof Nothing) {
        if (c.isMap) {
          return new TyMap(atPrefix(append18(prefix)([SElem.value])));
        }
        ;
        var $496 = c.isArray || hasElem;
        if ($496) {
          return new TyArray(atPrefix(append18(prefix)([SElem.value])));
        }
        ;
        var $497 = !$$null(keyKids) || !isEmpty2(c.fields);
        if ($497) {
          return new TyObject(fromFoldable22(map28(function(k) {
            return new Tuple(k, atPrefix(append18(prefix)([new SKey(k)])));
          })(keyKids)));
        }
        ;
        var s = (function() {
          var $498 = eq42(c.scalar)(SUnknown.value);
          if ($498) {
            return fromMaybe(SUnknown.value)(lookup11(canonKey(prefix))(obs));
          }
          ;
          return c.scalar;
        })();
        return new TyScalar(s, c.optional);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 600, column 7 - line 618, column 36): " + [c.enumTag.constructor.name]);
    };
    return atPrefix([]);
  };
};
var arrayPack = /* @__PURE__ */ fromFoldable13(["count", "size", "length", "join", "at", "take", "takeRight", "unique", "reverse"]);
var walk = function(sc) {
  return foldl6(node(sc));
};
var useExpr = function(sc) {
  return function(cs) {
    return function(expr) {
      var pinFirst = function(pin) {
        return function(v2) {
          return function(args) {
            return function(acc) {
              var v1 = head(args);
              if (v1 instanceof Just) {
                return foldl6(useExpr(sc))(pin(v1.value0)(acc))(fromMaybe([])(tail(args)));
              }
              ;
              if (v1 instanceof Nothing) {
                return acc;
              }
              ;
              throw new Error("Failed pattern match at Kernel.Schema (line 333, column 29 - line 335, column 19): " + [v1.constructor.name]);
            };
          };
        };
      };
      var optionalFirst = function(sc$prime) {
        return function(args) {
          return function(acc) {
            var v2 = uncons(args);
            if (v2 instanceof Just) {
              var acc1 = (function() {
                var v1 = exprCanon(sc$prime)(v2.value0.head);
                if (v1 instanceof Just) {
                  return record(v1.value0)({
                    isArray: emptyC.isArray,
                    isMap: emptyC.isMap,
                    fields: emptyC.fields,
                    scalar: emptyC.scalar,
                    enumTag: emptyC.enumTag,
                    enumVariants: emptyC.enumVariants,
                    coupled: emptyC.coupled,
                    optional: true
                  })(acc);
                }
                ;
                if (v1 instanceof Nothing) {
                  return useExpr(sc$prime)(acc)(v2.value0.head);
                }
                ;
                throw new Error("Failed pattern match at Kernel.Schema (line 339, column 16 - line 341, column 43): " + [v1.constructor.name]);
              })();
              return foldl6(useExpr(sc$prime))(acc1)(v2.value0.tail);
            }
            ;
            if (v2 instanceof Nothing) {
              return acc;
            }
            ;
            throw new Error("Failed pattern match at Kernel.Schema (line 336, column 32 - line 344, column 19): " + [v2.constructor.name]);
          };
        };
      };
      var litScalar = function(v2) {
        if (v2 instanceof Lit && v2.value0 instanceof VString) {
          return new Just(SString.value);
        }
        ;
        if (v2 instanceof Lit && v2.value0 instanceof VNumber) {
          return new Just(SNumber.value);
        }
        ;
        if (v2 instanceof Lit && v2.value0 instanceof VBool) {
          return new Just(SBool.value);
        }
        ;
        return Nothing.value;
      };
      var link = function(cA) {
        return function(cB) {
          return function(acc) {
            return record(cA)({
              isArray: emptyC.isArray,
              isMap: emptyC.isMap,
              fields: emptyC.fields,
              scalar: emptyC.scalar,
              optional: emptyC.optional,
              enumTag: emptyC.enumTag,
              enumVariants: emptyC.enumVariants,
              coupled: singleton8(canonKey(cB))
            })(record(cB)({
              isArray: emptyC.isArray,
              isMap: emptyC.isMap,
              fields: emptyC.fields,
              scalar: emptyC.scalar,
              optional: emptyC.optional,
              enumTag: emptyC.enumTag,
              enumVariants: emptyC.enumVariants,
              coupled: singleton8(canonKey(cA))
            })(acc));
          };
        };
      };
      var keyOf = function(args) {
        var v2 = head(args);
        if (v2 instanceof Just && (v2.value0 instanceof Lit && v2.value0.value0 instanceof VString)) {
          return new Just(v2.value0.value0.value0);
        }
        ;
        return Nothing.value;
      };
      var hashKeys = function(tail2) {
        var keysOf = function(kvs) {
          var v3 = uncons(kvs);
          if (v3 instanceof Just && (v3.value0.head instanceof Lit && v3.value0.head.value0 instanceof VString)) {
            return cons(v3.value0.head.value0.value0)(keysOf(drop(1)(v3.value0.tail)));
          }
          ;
          return [];
        };
        var isDict = function(v3) {
          if (v3 instanceof App2 && v3.value0 === "dict") {
            return true;
          }
          ;
          return false;
        };
        var v2 = find2(isDict)(tail2);
        if (v2 instanceof Just && (v2.value0 instanceof App2 && v2.value0.value0 === "dict")) {
          return keysOf(v2.value0.value1);
        }
        ;
        return [];
      };
      var partialUse = function(args) {
        return function(acc) {
          var v2 = uncons(args);
          var v1 = function(v22) {
            return foldl6(useExpr(sc))(acc)(args);
          };
          if (v2 instanceof Just && (v2.value0.head instanceof Lit && v2.value0.head.value0 instanceof VString)) {
            var $532 = lookup11(v2.value0.head.value0.value0)(sc.partials);
            if ($532 instanceof Just) {
              var $533 = !member6(v2.value0.head.value0.value0)(sc.visiting);
              if ($533) {
                var ctxCanon = bind11(head(v2.value0.tail))(exprCanon(sc));
                var sc$prime = {
                  partials: sc.partials,
                  current: fromMaybe(sc.current)(ctxCanon),
                  parents: cons(sc.current)(sc.parents),
                  binds: empty2,
                  shadowed: union10(sc.shadowed)(fromFoldable13(hashKeys(v2.value0.tail))),
                  visiting: insert1(v2.value0.head.value0.value0)(sc.visiting)
                };
                var acc1 = foldl6(useExpr(sc))(acc)(v2.value0.tail);
                return walk(sc$prime)(acc1)($532.value0);
              }
              ;
              return v1(true);
            }
            ;
            return v1(true);
          }
          ;
          return v1(true);
        };
      };
      var filterUse = function(args) {
        return function(acc) {
          var v2 = uncons(args);
          if (v2 instanceof Just) {
            var acc1 = pinArray(sc)(v2.value0.head)(acc);
            var v1 = keyOf(v2.value0.tail);
            var v22 = exprCanon(sc)(v2.value0.head);
            if (v22 instanceof Just && v1 instanceof Just) {
              return record(append18(v22.value0)([SElem.value, new SKey(v1.value0)]))(emptyC)(acc1);
            }
            ;
            return acc1;
          }
          ;
          if (v2 instanceof Nothing) {
            return acc;
          }
          ;
          throw new Error("Failed pattern match at Kernel.Schema (line 346, column 24 - line 354, column 19): " + [v2.constructor.name]);
        };
      };
      var coupleAll = function(canons) {
        return function(acc) {
          var v2 = uncons(canons);
          if (v2 instanceof Just) {
            return foldl6(function(a) {
              return function(cB) {
                return link(v2.value0.head)(cB)(a);
              };
            })(acc)(v2.value0.tail);
          }
          ;
          if (v2 instanceof Nothing) {
            return acc;
          }
          ;
          throw new Error("Failed pattern match at Kernel.Schema (line 327, column 26 - line 329, column 19): " + [v2.constructor.name]);
        };
      };
      var compareUse = function(args) {
        return function(acc) {
          var v2 = findMap(litScalar)(args);
          if (v2 instanceof Just) {
            return foldl6(function(a) {
              return function(e) {
                return pinScalar(sc)(v2.value0)(e)(a);
              };
            })(acc)(args);
          }
          ;
          if (v2 instanceof Nothing) {
            var acc1 = foldl6(useExpr(sc))(acc)(args);
            return coupleAll(mapMaybe(exprCanon(sc))(args))(acc1);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Schema (line 314, column 25 - line 320, column 60): " + [v2.constructor.name]);
        };
      };
      if (expr instanceof Lit) {
        return cs;
      }
      ;
      if (expr instanceof App2 && expr.value0 === "lookup") {
        var v = exprCanon(sc)(expr);
        if (v instanceof Just) {
          return record(v.value0)({
            isArray: emptyC.isArray,
            isMap: emptyC.isMap,
            fields: emptyC.fields,
            optional: emptyC.optional,
            enumTag: emptyC.enumTag,
            enumVariants: emptyC.enumVariants,
            coupled: emptyC.coupled,
            scalar: SUnknown.value
          })(cs);
        }
        ;
        if (v instanceof Nothing) {
          return cs;
        }
        ;
        throw new Error("Failed pattern match at Kernel.Schema (line 292, column 21 - line 294, column 18): " + [v.constructor.name]);
      }
      ;
      if (expr instanceof App2 && expr.value1.length === 0) {
        var v = exprCanon(sc)(expr);
        if (v instanceof Just) {
          return record(v.value0)({
            isArray: emptyC.isArray,
            isMap: emptyC.isMap,
            fields: emptyC.fields,
            optional: emptyC.optional,
            enumTag: emptyC.enumTag,
            enumVariants: emptyC.enumVariants,
            coupled: emptyC.coupled,
            scalar: SUnknown.value
          })(cs);
        }
        ;
        if (v instanceof Nothing) {
          return cs;
        }
        ;
        throw new Error("Failed pattern match at Kernel.Schema (line 295, column 15 - line 297, column 18): " + [v.constructor.name]);
      }
      ;
      if (expr instanceof App2 && expr.value0 === "partial") {
        return partialUse(expr.value1)(cs);
      }
      ;
      if (expr instanceof App2) {
        if (member6(expr.value0)(filterPack)) {
          return filterUse(expr.value1)(cs);
        }
        ;
        if (member6(expr.value0)(comparePack)) {
          return compareUse(expr.value1)(cs);
        }
        ;
        if (member6(expr.value0)(stringPack)) {
          return pinFirst(pinScalar(sc)(SString.value))(expr.value0)(expr.value1)(cs);
        }
        ;
        if (member6(expr.value0)(numberPack)) {
          return foldl6(function(acc) {
            return function(a) {
              return pinScalar(sc)(SNumber.value)(a)(acc);
            };
          })(cs)(expr.value1);
        }
        ;
        if (member6(expr.value0)(arrayPack)) {
          return pinFirst(pinArray(sc))(expr.value0)(expr.value1)(cs);
        }
        ;
        if (expr.value0 === "coalesce") {
          return optionalFirst(sc)(expr.value1)(cs);
        }
        ;
        if (otherwise) {
          return foldl6(useExpr(sc))(cs)(expr.value1);
        }
        ;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 290, column 22 - line 309, column 46): " + [expr.constructor.name]);
    };
  };
};
var pinScalar = function(sc) {
  return function(hint) {
    return function(e) {
      return function(cs) {
        var v = exprCanon(sc)(e);
        if (v instanceof Just) {
          return record(v.value0)({
            isArray: emptyC.isArray,
            isMap: emptyC.isMap,
            fields: emptyC.fields,
            optional: emptyC.optional,
            enumTag: emptyC.enumTag,
            enumVariants: emptyC.enumVariants,
            coupled: emptyC.coupled,
            scalar: hint
          })(cs);
        }
        ;
        if (v instanceof Nothing) {
          return useExpr(sc)(cs)(e);
        }
        ;
        throw new Error("Failed pattern match at Kernel.Schema (line 277, column 26 - line 279, column 29): " + [v.constructor.name]);
      };
    };
  };
};
var pinArray = function(sc) {
  return function(e) {
    return function(cs) {
      var v = exprCanon(sc)(e);
      if (v instanceof Just) {
        return record(v.value0)({
          isMap: emptyC.isMap,
          fields: emptyC.fields,
          scalar: emptyC.scalar,
          optional: emptyC.optional,
          enumTag: emptyC.enumTag,
          enumVariants: emptyC.enumVariants,
          coupled: emptyC.coupled,
          isArray: true
        })(cs);
      }
      ;
      if (v instanceof Nothing) {
        return useExpr(sc)(cs)(e);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 283, column 20 - line 285, column 29): " + [v.constructor.name]);
    };
  };
};
var node = function(sc) {
  return function(cs) {
    return function(v) {
      if (v instanceof Content) {
        return cs;
      }
      ;
      if (v instanceof Output) {
        return useExpr(sc)(cs)(v.value1);
      }
      ;
      if (v instanceof Sep) {
        return foldl6(useExpr(sc))(cs)(v.value2);
      }
      ;
      if (v instanceof RawBlock) {
        return cs;
      }
      ;
      if (v instanceof NodeError) {
        return cs;
      }
      ;
      if (v instanceof Block) {
        return block(sc)(cs)(v.value2)(v.value3)(v.value4);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Schema (line 398, column 14 - line 404, column 57): " + [v.constructor.name]);
    };
  };
};
var markCond = function(sc) {
  return function(cs) {
    return function(conds) {
      return function(body) {
        var opt = hasElse(body);
        var step2 = function(acc) {
          return function(e) {
            var v = exprCanon(sc)(e);
            if (v instanceof Just) {
              return record(v.value0)({
                isArray: emptyC.isArray,
                isMap: emptyC.isMap,
                fields: emptyC.fields,
                scalar: emptyC.scalar,
                enumTag: emptyC.enumTag,
                enumVariants: emptyC.enumVariants,
                coupled: emptyC.coupled,
                optional: opt
              })(acc);
            }
            ;
            if (v instanceof Nothing) {
              return useExpr(sc)(acc)(e);
            }
            ;
            throw new Error("Failed pattern match at Kernel.Schema (line 493, column 16 - line 495, column 32): " + [v.constructor.name]);
          };
        };
        return foldl6(step2)(cs)(conds);
      };
    };
  };
};
var block = function(sc) {
  return function(cs) {
    return function(name2) {
      return function(args) {
        return function(body) {
          var withBlock = function(split3) {
            var v = head(split3.positional);
            if (v instanceof Just) {
              var oc = fromMaybe(sc.current)(exprCanon(sc)(v.value0));
              var sc$prime = {
                binds: sc.binds,
                partials: sc.partials,
                shadowed: sc.shadowed,
                visiting: sc.visiting,
                current: oc,
                parents: cons(sc.current)(sc.parents)
              };
              var cs1 = useExpr(sc)(cs)(v.value0);
              return walk(sc$prime)(cs1)(body);
            }
            ;
            if (v instanceof Nothing) {
              return walk(sc)(cs)(body);
            }
            ;
            throw new Error("Failed pattern match at Kernel.Schema (line 446, column 5 - line 454, column 33): " + [v.constructor.name]);
          };
          var letBlock2 = function(split3) {
            var pairs = hashPairs(split3.hash);
            var names = map28(fst)(pairs);
            var sc$prime = {
              binds: sc.binds,
              current: sc.current,
              parents: sc.parents,
              partials: sc.partials,
              visiting: sc.visiting,
              shadowed: union10(sc.shadowed)(fromFoldable13(names))
            };
            var cs1 = foldl6(function(acc) {
              return function(v) {
                return useExpr(sc)(acc)(v.value1);
              };
            })(cs)(pairs);
            return walk(sc$prime)(cs1)(body);
          };
          var eachBlock = function(split3) {
            var v = head(split3.positional);
            if (v instanceof Just) {
              var param = head(split3.params);
              var isMapIter = mentionsKey(body);
              var collCanon = exprCanon(sc)(v.value0);
              var cs1 = (function() {
                if (collCanon instanceof Just) {
                  return record(collCanon.value0)({
                    fields: emptyC.fields,
                    scalar: emptyC.scalar,
                    optional: emptyC.optional,
                    enumTag: emptyC.enumTag,
                    enumVariants: emptyC.enumVariants,
                    coupled: emptyC.coupled,
                    isArray: !isMapIter,
                    isMap: isMapIter
                  })(cs);
                }
                ;
                if (collCanon instanceof Nothing) {
                  return useExpr(sc)(cs)(v.value0);
                }
                ;
                throw new Error("Failed pattern match at Kernel.Schema (line 431, column 17 - line 433, column 46): " + [collCanon.constructor.name]);
              })();
              var elemCanon = map112(function(v1) {
                return append18(v1)([SElem.value]);
              })(collCanon);
              var childCanon = fromMaybe(sc.current)(elemCanon);
              var binds$prime = (function() {
                if (param instanceof Just && elemCanon instanceof Just) {
                  return insert9(param.value0)(elemCanon.value0)(sc.binds);
                }
                ;
                return sc.binds;
              })();
              var sc$prime = {
                partials: sc.partials,
                shadowed: sc.shadowed,
                visiting: sc.visiting,
                current: childCanon,
                parents: cons(sc.current)(sc.parents),
                binds: binds$prime
              };
              return walk(sc$prime)(cs1)(body);
            }
            ;
            if (v instanceof Nothing) {
              return walk(sc)(cs)(body);
            }
            ;
            throw new Error("Failed pattern match at Kernel.Schema (line 426, column 5 - line 444, column 33): " + [v.constructor.name]);
          };
          var caseBlock2 = function(split3) {
            var variants = whenLiterals(body);
            var subjCanon = bind11(head(split3.positional))(exprCanon(sc));
            var cs1 = walk(sc)(foldl6(useExpr(sc))(cs)(split3.positional))(body);
            var v = function(v1) {
              if (subjCanon instanceof Just && !isEmpty2(variants)) {
                return record(subjCanon.value0)({
                  isArray: emptyC.isArray,
                  isMap: emptyC.isMap,
                  fields: emptyC.fields,
                  optional: emptyC.optional,
                  enumTag: emptyC.enumTag,
                  enumVariants: emptyC.enumVariants,
                  coupled: emptyC.coupled,
                  scalar: SString.value
                })(cs1);
              }
              ;
              return cs1;
            };
            if (subjCanon instanceof Just) {
              var $609 = unsnoc(subjCanon.value0);
              if ($609 instanceof Just && $609.value0.last instanceof SKey) {
                var $610 = last($609.value0.init);
                if ($610 instanceof Just && $610.value0 instanceof SElem) {
                  var $611 = !isEmpty2(variants);
                  if ($611) {
                    return record($609.value0.init)({
                      isArray: emptyC.isArray,
                      isMap: emptyC.isMap,
                      fields: emptyC.fields,
                      scalar: emptyC.scalar,
                      optional: emptyC.optional,
                      coupled: emptyC.coupled,
                      enumTag: new Just($609.value0.last.value0),
                      enumVariants: variants
                    })(cs1);
                  }
                  ;
                  return v(true);
                }
                ;
                return v(true);
              }
              ;
              return v(true);
            }
            ;
            return v(true);
          };
          var split2 = splitBlockArgs(args);
          if (name2 === "each") {
            return eachBlock(split2);
          }
          ;
          if (name2 === "with") {
            return withBlock(split2);
          }
          ;
          if (name2 === "if") {
            return walk(sc)(markCond(sc)(cs)(split2.positional)(body))(body);
          }
          ;
          if (name2 === "unless") {
            return walk(sc)(markCond(sc)(cs)(split2.positional)(body))(body);
          }
          ;
          if (name2 === "let") {
            return letBlock2(split2);
          }
          ;
          if (name2 === "local") {
            return letBlock2(split2);
          }
          ;
          if (name2 === "inline") {
            return cs;
          }
          ;
          if (name2 === "case") {
            return caseBlock2(split2);
          }
          ;
          return walk(sc)(foldl6(useExpr(sc))(cs)(split2.positional))(body);
        };
      };
    };
  };
};
var inferTemplateData = function(samples) {
  return function(tmpl) {
    var sc0 = {
      binds: rootScope.binds,
      current: rootScope.current,
      parents: rootScope.parents,
      shadowed: rootScope.shadowed,
      visiting: rootScope.visiting,
      partials: collectInlines(tmpl)
    };
    var obs = observeScalars(samples);
    var cs = refineEnums(observeTags(samples))(propagateCouples(refineScalars(obs)(walk(sc0)(empty2)(tmpl))));
    var ty = buildTy(obs)(cs);
    return {
      schema: emitSchema(ty),
      dataScaffold: scaffoldJson(ty),
      report: emitReport(ty),
      conflicts: countConflicts(ty)
    };
  };
};
var inferTemplate = /* @__PURE__ */ inferTemplateData([]);

// output/MaxBars.Expr/index.js
var map29 = /* @__PURE__ */ map(functorMaybe);
var bind12 = /* @__PURE__ */ bind(bindMaybe);
var bind13 = /* @__PURE__ */ bind(bindEither);
var append5 = /* @__PURE__ */ append(semigroupArray);
var map113 = /* @__PURE__ */ map(functorEither);
var isAtVar = function(name2) {
  return isJust(stripPrefix("@")(name2));
};
var atVarError = /* @__PURE__ */ (function() {
  return LexError.create("'@\u2026' variables are not used in MaxBars; read the loop/context model instead (e.g. {{loop.index0}}, {{parent.x}}, {{root.y}})");
})();
var combinators = function(toks) {
  var tk = function(i) {
    return map29(function(v) {
      return v.tok;
    })(index(toks)(i));
  };
  var posAt = function(i) {
    var v = index(toks)(i);
    if (v instanceof Just) {
      return v.value0.at;
    }
    ;
    if (v instanceof Nothing) {
      var v1 = last(toks);
      if (v1 instanceof Just) {
        return v1.value0.at;
      }
      ;
      if (v1 instanceof Nothing) {
        return 0;
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Expr (line 115, column 16 - line 117, column 19): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Expr (line 113, column 13 - line 117, column 19): " + [v.constructor.name]);
  };
  var pipeOp = function(v) {
    if (v instanceof TOp && v.value0 === "|") {
      return new Just(function(l) {
        return function(r) {
          if (r instanceof App2) {
            return new App2(r.value0, cons(l)(r.value1));
          }
          ;
          return r;
        };
      });
    }
    ;
    return Nothing.value;
  };
  var mulOp = /* @__PURE__ */ (function() {
    var bin = function(h) {
      return new Just(function(a) {
        return function(b) {
          return new App2(h, [a, b]);
        };
      });
    };
    return function(v) {
      if (v instanceof TOp && v.value0 === "*") {
        return bin("multiply");
      }
      ;
      if (v instanceof TOp && v.value0 === "/") {
        return bin("divide");
      }
      ;
      if (v instanceof TOp && v.value0 === "%") {
        return bin("modulo");
      }
      ;
      return Nothing.value;
    };
  })();
  var len = length(toks);
  var cmpOp = /* @__PURE__ */ (function() {
    var bin = function(h) {
      return new Just(function(a) {
        return function(b) {
          return new App2(h, [a, b]);
        };
      });
    };
    return function(v) {
      if (v instanceof TOp && v.value0 === "==") {
        return bin("eq");
      }
      ;
      if (v instanceof TOp && v.value0 === "!=") {
        return bin("ne");
      }
      ;
      if (v instanceof TOp && v.value0 === "<=") {
        return bin("lte");
      }
      ;
      if (v instanceof TOp && v.value0 === ">=") {
        return bin("gte");
      }
      ;
      if (v instanceof TOp && v.value0 === "<") {
        return bin("lt");
      }
      ;
      if (v instanceof TOp && v.value0 === ">") {
        return bin("gt");
      }
      ;
      return Nothing.value;
    };
  })();
  var binOp = function(sym) {
    return function(helper) {
      return function(v) {
        if (v instanceof TOp && v.value0 === sym) {
          return new Just(function(a) {
            return function(b) {
              return new App2(helper, [a, b]);
            };
          });
        }
        ;
        return Nothing.value;
      };
    };
  };
  var binL = function(match) {
    return function(sub3) {
      return function(i) {
        var loop = function(lhs) {
          return function(pos) {
            var v = bind12(tk(pos))(match);
            if (v instanceof Just) {
              return bind13(sub3(pos + 1 | 0))(function(r) {
                return loop(v.value0(lhs)(r.val))(r.pos);
              });
            }
            ;
            if (v instanceof Nothing) {
              return new Right({
                val: lhs,
                pos
              });
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Expr (line 127, column 20 - line 129, column 41): " + [v.constructor.name]);
          };
        };
        return bind13(sub3(i))(function(first) {
          return loop(first.val)(first.pos);
        });
      };
    };
  };
  var addOp = /* @__PURE__ */ (function() {
    var bin = function(h) {
      return new Just(function(a) {
        return function(b) {
          return new App2(h, [a, b]);
        };
      });
    };
    return function(v) {
      if (v instanceof TOp && v.value0 === "+") {
        return bin("add");
      }
      ;
      if (v instanceof TOp && v.value0 === "-") {
        return bin("subtract");
      }
      ;
      if (v instanceof TOp && v.value0 === "~") {
        return bin("concat");
      }
      ;
      return Nothing.value;
    };
  })();
  var ladder = function(withPipe) {
    return function(term) {
      var pUnary = function(i) {
        var v = tk(i);
        if (v instanceof Just && (v.value0 instanceof TOp && v.value0.value0 === "!")) {
          return bind13(pUnary(i + 1 | 0))(function(r) {
            return new Right({
              val: new App2("not", [r.val]),
              pos: r.pos
            });
          });
        }
        ;
        return term(i);
      };
      var pMul = function(i) {
        return binL(mulOp)(pUnary)(i);
      };
      var pAdd = function(i) {
        return binL(addOp)(pMul)(i);
      };
      var pRange = function(i) {
        return bind13(pAdd(i))(function(lhs) {
          var v = tk(lhs.pos);
          if (v instanceof Just && (v.value0 instanceof TOp && v.value0.value0 === "..")) {
            return bind13(pAdd(lhs.pos + 1 | 0))(function(r) {
              return new Right({
                val: new App2("range", [lhs.val, r.val]),
                pos: r.pos
              });
            });
          }
          ;
          return new Right({
            val: lhs.val,
            pos: lhs.pos
          });
        });
      };
      var pCmp = function(i) {
        return bind13(pRange(i))(function(lhs) {
          var v = bind12(tk(lhs.pos))(cmpOp);
          if (v instanceof Just) {
            return bind13(pRange(lhs.pos + 1 | 0))(function(r) {
              return new Right({
                val: v.value0(lhs.val)(r.val),
                pos: r.pos
              });
            });
          }
          ;
          if (v instanceof Nothing) {
            return new Right({
              val: lhs.val,
              pos: lhs.pos
            });
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Expr (line 164, column 35 - line 166, column 54): " + [v.constructor.name]);
        });
      };
      var pAnd = function(i) {
        return binL(binOp("&&")("and"))(pCmp)(i);
      };
      var pOr = function(i) {
        return binL(binOp("||")("or"))(pAnd)(i);
      };
      var pElvis = function(i) {
        return binL(binOp("?:")("firstTruthy"))(pOr)(i);
      };
      var pCoalesce = function(i) {
        return binL(binOp("??")("coalesce"))(pElvis)(i);
      };
      var pPipe = function(i) {
        return binL(pipeOp)(pCoalesce)(i);
      };
      var below = (function() {
        if (withPipe) {
          return pPipe;
        }
        ;
        return pCoalesce;
      })();
      var pTernary = function(i) {
        return bind13(below(i))(function(cond) {
          var v = tk(cond.pos);
          if (v instanceof Just && (v.value0 instanceof TOp && v.value0.value0 === "?")) {
            return bind13(pTernary(cond.pos + 1 | 0))(function(thenB) {
              var v1 = tk(thenB.pos);
              if (v1 instanceof Just && (v1.value0 instanceof TOp && v1.value0.value0 === ":")) {
                return bind13(pTernary(thenB.pos + 1 | 0))(function(elseB) {
                  return new Right({
                    val: new App2("ternary", [cond.val, thenB.val, elseB.val]),
                    pos: elseB.pos
                  });
                });
              }
              ;
              return new Left(new LexError("expected ':' to complete the ternary 'cond ? a : b'", posAt(thenB.pos)));
            });
          }
          ;
          return new Right(cond);
        });
      };
      return pTernary;
    };
  };
  var pList = function(i) {
    var go = function(j) {
      return function(acc) {
        return bind13(exprLadder(j))(function(e) {
          var v2 = tk(e.pos);
          if (v2 instanceof Just && v2.value0 instanceof TComma) {
            return go(e.pos + 1 | 0)(snoc(acc)(e.val));
          }
          ;
          if (v2 instanceof Just && v2.value0 instanceof TRBracket) {
            return new Right({
              val: new App2("list", snoc(acc)(e.val)),
              pos: e.pos + 1 | 0
            });
          }
          ;
          return new Left(new LexError("expected ',' or ']' to continue the list literal", posAt(e.pos)));
        });
      };
    };
    var v = tk(i);
    if (v instanceof Just && v.value0 instanceof TRBracket) {
      return new Right({
        val: new App2("list", []),
        pos: i + 1 | 0
      });
    }
    ;
    return go(i)([]);
  };
  var pDict = function(i) {
    var key = function(j) {
      var v2 = tk(j);
      if (v2 instanceof Just && v2.value0 instanceof TIdent) {
        return new Right({
          val: v2.value0.value0,
          pos: j + 1 | 0
        });
      }
      ;
      if (v2 instanceof Just && v2.value0 instanceof TStr) {
        return new Right({
          val: v2.value0.value0,
          pos: j + 1 | 0
        });
      }
      ;
      return new Left(new LexError("expected a dict key (an identifier or a string)", posAt(j)));
    };
    var go = function(j) {
      return function(acc) {
        return bind13(key(j))(function(k) {
          var v2 = tk(k.pos);
          if (v2 instanceof Just && (v2.value0 instanceof TOp && v2.value0.value0 === ":")) {
            return bind13(exprLadder(k.pos + 1 | 0))(function(v1) {
              var acc$prime = append5(acc)([new Lit(new VString(k.val)), v1.val]);
              var v22 = tk(v1.pos);
              if (v22 instanceof Just && v22.value0 instanceof TComma) {
                return go(v1.pos + 1 | 0)(acc$prime);
              }
              ;
              if (v22 instanceof Just && v22.value0 instanceof TRBrace) {
                return new Right({
                  val: new App2("dict", acc$prime),
                  pos: v1.pos + 1 | 0
                });
              }
              ;
              return new Left(new LexError("expected ',' or '}' to continue the dict literal", posAt(v1.pos)));
            });
          }
          ;
          return new Left(new LexError("expected ':' after a dict key", posAt(k.pos)));
        });
      };
    };
    var v = tk(i);
    if (v instanceof Just && v.value0 instanceof TRBrace) {
      return new Right({
        val: new App2("dict", []),
        pos: i + 1 | 0
      });
    }
    ;
    return go(i)([]);
  };
  var pAtom = function(i) {
    var v = tk(i);
    if (v instanceof Just && v.value0 instanceof TLParen) {
      return bind13(exprLadder(i + 1 | 0))(function(r) {
        var v1 = tk(r.pos);
        if (v1 instanceof Just && v1.value0 instanceof TRParen) {
          return new Right({
            val: r.val,
            pos: r.pos + 1 | 0
          });
        }
        ;
        return new Left(new LexError("expected )", posAt(r.pos)));
      });
    }
    ;
    if (v instanceof Just && v.value0 instanceof TStr) {
      return new Right({
        val: new Lit(new VString(v.value0.value0)),
        pos: i + 1 | 0
      });
    }
    ;
    if (v instanceof Just && v.value0 instanceof TNum) {
      return new Right({
        val: new Lit(new VNumber(v.value0.value0)),
        pos: i + 1 | 0
      });
    }
    ;
    if (v instanceof Just && v.value0 instanceof TLBracket) {
      return pList(i + 1 | 0);
    }
    ;
    if (v instanceof Just && v.value0 instanceof TLBrace) {
      return pDict(i + 1 | 0);
    }
    ;
    if (v instanceof Just && v.value0 instanceof TIdent) {
      if (isAtVar(v.value0.value0)) {
        return new Left(atVarError(posAt(i)));
      }
      ;
      if (otherwise) {
        return new Right({
          val: new App2(v.value0.value0, []),
          pos: i + 1 | 0
        });
      }
      ;
    }
    ;
    if (v instanceof Just && (v.value0 instanceof TOp && v.value0.value0 === "|")) {
      return new Left(new LexError("a bar is not allowed in a MaxBars block head: block params drop the pipes (write `as a b`, not `as |a b|`); to pipe a block argument, parenthesise it \u2014 e.g. (x | f)", posAt(i)));
    }
    ;
    return new Left(new LexError("expected an expression", posAt(i)));
  };
  var pArgs = function(i) {
    return function(acc) {
      var v = tk(i);
      if (v instanceof Just && v.value0 instanceof TLParen) {
        return bind13(pAtom(i))(function(r) {
          return pArgs(r.pos)(snoc(acc)(r.val));
        });
      }
      ;
      if (v instanceof Just && v.value0 instanceof TLBracket) {
        return bind13(pAtom(i))(function(r) {
          return pArgs(r.pos)(snoc(acc)(r.val));
        });
      }
      ;
      if (v instanceof Just && v.value0 instanceof TLBrace) {
        return bind13(pAtom(i))(function(r) {
          return pArgs(r.pos)(snoc(acc)(r.val));
        });
      }
      ;
      if (v instanceof Just && v.value0 instanceof TStr) {
        return pArgs(i + 1 | 0)(snoc(acc)(new Lit(new VString(v.value0.value0))));
      }
      ;
      if (v instanceof Just && v.value0 instanceof TNum) {
        return pArgs(i + 1 | 0)(snoc(acc)(new Lit(new VNumber(v.value0.value0))));
      }
      ;
      if (v instanceof Just && v.value0 instanceof TIdent) {
        if (isAtVar(v.value0.value0)) {
          return new Left(atVarError(posAt(i)));
        }
        ;
        if (otherwise) {
          return pArgs(i + 1 | 0)(snoc(acc)(new App2(v.value0.value0, [])));
        }
        ;
      }
      ;
      return new Right({
        val: acc,
        pos: i
      });
    };
  };
  var pApp = function(i) {
    var v = tk(i);
    if (v instanceof Just && v.value0 instanceof TIdent) {
      if (isAtVar(v.value0.value0)) {
        return new Left(atVarError(posAt(i)));
      }
      ;
      if (otherwise) {
        return bind13(pArgs(i + 1 | 0)([]))(function(r) {
          return new Right({
            val: new App2(v.value0.value0, r.val),
            pos: r.pos
          });
        });
      }
      ;
    }
    ;
    return pAtom(i);
  };
  var exprLadder = function(i) {
    return ladder(true)(pApp)(i);
  };
  var headLadder = function(i) {
    return ladder(false)(pAtom)(i);
  };
  return {
    exprLadder,
    headLadder,
    tk,
    posAt,
    len
  };
};
var parseMaxExpr = function(toks) {
  var comb = combinators(toks);
  var v = comb.exprLadder(0);
  if (v instanceof Left) {
    return new Left(v.value0);
  }
  ;
  if (v instanceof Right) {
    if (v.value0.pos >= comb.len) {
      return new Right(v.value0.val);
    }
    ;
    if (otherwise) {
      return new Left(new LexError("unexpected token", comb.posAt(v.value0.pos)));
    }
    ;
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Expr (line 67, column 21 - line 71, column 66): " + [v.constructor.name]);
};
var parseMaxHead = function(toks) {
  var comb = combinators(toks);
  var collect2 = function($copy_i) {
    return function($copy_acc) {
      var $tco_var_i = $copy_i;
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(i, acc) {
        if (i >= comb.len) {
          $tco_done = true;
          return new Right(acc);
        }
        ;
        if (otherwise) {
          var v2 = comb.headLadder(i);
          if (v2 instanceof Left) {
            $tco_done = true;
            return new Left(v2.value0);
          }
          ;
          if (v2 instanceof Right) {
            if (v2.value0.pos === i) {
              $tco_done = true;
              return new Left(new LexError("unexpected token", comb.posAt(i)));
            }
            ;
            if (otherwise) {
              $tco_var_i = v2.value0.pos;
              $copy_acc = snoc(acc)(v2.value0.val);
              return;
            }
            ;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Expr (line 92, column 19 - line 96, column 62): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Expr (line 90, column 3 - line 96, column 62): " + [i.constructor.name, acc.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($tco_var_i, $copy_acc);
      }
      ;
      return $tco_result;
    };
  };
  var v = comb.tk(0);
  if (v instanceof Just && v.value0 instanceof TIdent) {
    if (isAtVar(v.value0.value0)) {
      return new Left(atVarError(comb.posAt(0)));
    }
    ;
    if (otherwise) {
      return map113(App2.create(v.value0.value0))(collect2(1)([]));
    }
    ;
  }
  ;
  return new Left(new LexError("expected a block helper name", comb.posAt(0)));
};

// output/MaxBars.Token/index.js
var elem16 = /* @__PURE__ */ elem2(eqChar);
var eqMaybe3 = /* @__PURE__ */ eqMaybe(eqChar);
var eq16 = /* @__PURE__ */ eq(eqMaybe3);
var notEq6 = /* @__PURE__ */ notEq(eqMaybe3);
var $$unescape2 = function(v) {
  if (v === "\\") {
    return new Just("\\");
  }
  ;
  if (v === '"') {
    return new Just('"');
  }
  ;
  if (v === "'") {
    return new Just("'");
  }
  ;
  if (v === "n") {
    return new Just("\n");
  }
  ;
  if (v === "t") {
    return new Just("	");
  }
  ;
  if (v === "r") {
    return new Just("\r");
  }
  ;
  return Nothing.value;
};
var maxOperatorChars = "+-*/%?:~";
var isWs2 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var isDigit2 = function(c) {
  return c >= "0" && c <= "9";
};
var isNumChar2 = function(c) {
  return isDigit2(c) || c === ".";
};
var isAlpha2 = function(c) {
  return c >= "a" && c <= "z" || c >= "A" && c <= "Z";
};
var isIdentChar3 = function(c) {
  return isAlpha2(c) || (isDigit2(c) || (c === "_" || (c === "-" || (c === "." || (c === "@" || (c === "/" || (c === "+" || (c === "*" || (c === "?" || c === "=")))))))));
};
var tokenizeInterior2 = function(base) {
  return function(src) {
    var push4 = function(acc) {
      return function(t) {
        return function(i) {
          return function(j) {
            return snoc(acc)({
              tok: t,
              at: base + i | 0,
              end: base + j | 0
            });
          };
        };
      };
    };
    var opChars = toCharArray(maxOperatorChars);
    var isOp = function(c) {
      return elem16(c)(opChars);
    };
    var identChar = function(c) {
      return isIdentChar3(c) && !isOp(c);
    };
    var cs = toCharArray(src);
    var len = length(cs);
    var slc = function(a) {
      return function(b) {
        return fromCharArray(slice(a)(b)(cs));
      };
    };
    var bad = function(i) {
      return new Left(new LexError("unexpected character", base + i | 0));
    };
    var at = function(i) {
      return index(cs)(i);
    };
    var rangeAt = function(j) {
      return eq16(at(j))(new Just(".")) && eq16(at(j + 1 | 0))(new Just("."));
    };
    var readString = function(start) {
      return function(q) {
        return function(acc) {
          var collect2 = function($copy_j) {
            return function($copy_chars) {
              var $tco_var_j = $copy_j;
              var $tco_done = false;
              var $tco_result;
              function $tco_loop(j, chars) {
                var v = at(j);
                if (v instanceof Nothing) {
                  $tco_done = true;
                  return new Left(new LexError("unterminated string", base + start | 0));
                }
                ;
                if (v instanceof Just) {
                  if (v.value0 === q) {
                    $tco_done = true;
                    return go(j + 1 | 0)(push4(acc)(new TStr(fromCharArray(reverse(chars))))(start)(j + 1 | 0));
                  }
                  ;
                  if (v.value0 === "\\") {
                    var v1 = at(j + 1 | 0);
                    if (v1 instanceof Just) {
                      var v2 = $$unescape2(v1.value0);
                      if (v2 instanceof Just) {
                        $tco_var_j = j + 2 | 0;
                        $copy_chars = cons(v2.value0)(chars);
                        return;
                      }
                      ;
                      if (v2 instanceof Nothing) {
                        $tco_done = true;
                        return new Left(new LexError("invalid string escape", base + j | 0));
                      }
                      ;
                      throw new Error("Failed pattern match at MaxBars.Token (line 173, column 23 - line 175, column 76): " + [v2.constructor.name]);
                    }
                    ;
                    if (v1 instanceof Nothing) {
                      $tco_done = true;
                      return new Left(new LexError("unterminated string", base + start | 0));
                    }
                    ;
                    throw new Error("Failed pattern match at MaxBars.Token (line 172, column 24 - line 176, column 76): " + [v1.constructor.name]);
                  }
                  ;
                  if (otherwise) {
                    $tco_var_j = j + 1 | 0;
                    $copy_chars = cons(v.value0)(chars);
                    return;
                  }
                  ;
                }
                ;
                throw new Error("Failed pattern match at MaxBars.Token (line 167, column 23 - line 177, column 60): " + [v.constructor.name]);
              }
              ;
              while (!$tco_done) {
                $tco_result = $tco_loop($tco_var_j, $copy_chars);
              }
              ;
              return $tco_result;
            };
          };
          return collect2(start + 1 | 0)([]);
        };
      };
    };
    var readNumber = function(start) {
      return function(acc) {
        var numEnd = function($copy_j) {
          var $tco_done1 = false;
          var $tco_result;
          function $tco_loop(j) {
            if (rangeAt(j)) {
              $tco_done1 = true;
              return j;
            }
            ;
            if (otherwise) {
              var v2 = at(j);
              if (v2 instanceof Just && isNumChar2(v2.value0)) {
                $copy_j = j + 1 | 0;
                return;
              }
              ;
              $tco_done1 = true;
              return j;
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Token (line 158, column 5 - line 162, column 17): " + [j.constructor.name]);
          }
          ;
          while (!$tco_done1) {
            $tco_result = $tco_loop($copy_j);
          }
          ;
          return $tco_result;
        };
        var end = numEnd(start + 1 | 0);
        var raw = slc(start)(end);
        var v = fromString(raw);
        if (v instanceof Just) {
          return go(end)(push4(acc)(new TNum(v.value0))(start)(end));
        }
        ;
        if (v instanceof Nothing) {
          return new Left(new LexError("malformed number '" + (raw + "'"), base + start | 0));
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Token (line 152, column 7 - line 154, column 87): " + [v.constructor.name]);
      };
    };
    var readIdent = function(start) {
      return function(acc) {
        var skipWs = function($copy_k) {
          var $tco_done2 = false;
          var $tco_result;
          function $tco_loop(k) {
            var v = at(k);
            if (v instanceof Just && isWs2(v.value0)) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            $tco_done2 = true;
            return k;
          }
          ;
          while (!$tco_done2) {
            $tco_result = $tco_loop($copy_k);
          }
          ;
          return $tco_result;
        };
        var hashEqAt = function(j) {
          var w = skipWs(j);
          return j > start && (eq16(at(w))(new Just("=")) && notEq6(at(w + 1 | 0))(new Just("=")));
        };
        var bracketEnd = function($copy_k) {
          var $tco_done3 = false;
          var $tco_result;
          function $tco_loop(k) {
            if (k > len) {
              $tco_done3 = true;
              return Nothing.value;
            }
            ;
            if (eq16(at(k))(new Just("]"))) {
              $tco_done3 = true;
              return new Just(k);
            }
            ;
            if (otherwise) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Token (line 141, column 5 - line 144, column 39): " + [k.constructor.name]);
          }
          ;
          while (!$tco_done3) {
            $tco_result = $tco_loop($copy_k);
          }
          ;
          return $tco_result;
        };
        var scan = function($copy_j) {
          var $tco_done4 = false;
          var $tco_result;
          function $tco_loop(j) {
            var v = at(j);
            if (v instanceof Just && (v.value0 === "[" && notEq6(at(j - 1 | 0))(new Just(".")))) {
              $tco_done4 = true;
              return go(j)(push4(acc)(new TIdent(slc(start)(j)))(start)(j));
            }
            ;
            if (v instanceof Just && v.value0 === "[") {
              var v1 = bracketEnd(j + 1 | 0);
              if (v1 instanceof Just) {
                $copy_j = v1.value0 + 1 | 0;
                return;
              }
              ;
              if (v1 instanceof Nothing) {
                $tco_done4 = true;
                return new Left(new LexError("unterminated [ segment", base + j | 0));
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Token (line 120, column 19 - line 122, column 71): " + [v1.constructor.name]);
            }
            ;
            if (rangeAt(j)) {
              $tco_done4 = true;
              return go(j)(push4(acc)(new TIdent(slc(start)(j)))(start)(j));
            }
            ;
            if (v instanceof Just && identChar(v.value0)) {
              $copy_j = j + 1 | 0;
              return;
            }
            ;
            if (hashEqAt(j)) {
              $tco_done4 = true;
              return go(skipWs(j) + 1 | 0)(push4(acc)(new TIdent(slc(start)(j) + "="))(start)(skipWs(j) + 1 | 0));
            }
            ;
            $tco_done4 = true;
            return go(j)(push4(acc)(new TIdent(slc(start)(j)))(start)(j));
          }
          ;
          while (!$tco_done4) {
            $tco_result = $tco_loop($copy_j);
          }
          ;
          return $tco_result;
        };
        return scan(start);
      };
    };
    var op2 = function(s) {
      return function(i) {
        return function(acc) {
          return go(i + 2 | 0)(push4(acc)(new TOp(s))(i)(i + 2 | 0));
        };
      };
    };
    var op1 = function(s) {
      return function(i) {
        return function(acc) {
          return go(i + 1 | 0)(push4(acc)(new TOp(s))(i)(i + 1 | 0));
        };
      };
    };
    var go = function($copy_i) {
      return function($copy_acc) {
        var $tco_var_i = $copy_i;
        var $tco_done5 = false;
        var $tco_result;
        function $tco_loop(i, acc) {
          if (i >= len) {
            $tco_done5 = true;
            return new Right(acc);
          }
          ;
          if (otherwise) {
            var v = at(i);
            if (v instanceof Nothing) {
              $tco_done5 = true;
              return new Right(acc);
            }
            ;
            if (v instanceof Just) {
              if (isWs2(v.value0)) {
                $tco_var_i = i + 1 | 0;
                $copy_acc = acc;
                return;
              }
              ;
              if (v.value0 === "(") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TLParen.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === ")") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TRParen.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === "[") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TLBracket.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === "]") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TRBracket.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === "{") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TLBrace.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === "}") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TRBrace.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === ",") {
                $tco_var_i = i + 1 | 0;
                $copy_acc = push4(acc)(TComma.value)(i)(i + 1 | 0);
                return;
              }
              ;
              if (v.value0 === '"' || v.value0 === "'") {
                $tco_done5 = true;
                return readString(i)(v.value0)(acc);
              }
              ;
              if (v.value0 === "&") {
                var $49 = eq16(at(i + 1 | 0))(new Just("&"));
                if ($49) {
                  $tco_done5 = true;
                  return op2("&&")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return bad(i);
              }
              ;
              if (v.value0 === "|") {
                var $50 = eq16(at(i + 1 | 0))(new Just("|"));
                if ($50) {
                  $tco_done5 = true;
                  return op2("||")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("|")(i)(acc);
              }
              ;
              if (v.value0 === "!") {
                var $51 = eq16(at(i + 1 | 0))(new Just("="));
                if ($51) {
                  $tco_done5 = true;
                  return op2("!=")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("!")(i)(acc);
              }
              ;
              if (v.value0 === "<") {
                var $52 = eq16(at(i + 1 | 0))(new Just("="));
                if ($52) {
                  $tco_done5 = true;
                  return op2("<=")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("<")(i)(acc);
              }
              ;
              if (v.value0 === ">") {
                var $53 = eq16(at(i + 1 | 0))(new Just("="));
                if ($53) {
                  $tco_done5 = true;
                  return op2(">=")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1(">")(i)(acc);
              }
              ;
              if (v.value0 === "=") {
                var $54 = eq16(at(i + 1 | 0))(new Just("="));
                if ($54) {
                  $tco_done5 = true;
                  return op2("==")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return bad(i);
              }
              ;
              if (rangeAt(i)) {
                $tco_done5 = true;
                return op2("..")(i)(acc);
              }
              ;
              if (v.value0 === "-" && maybe(false)(isDigit2)(at(i + 1 | 0))) {
                $tco_done5 = true;
                return readNumber(i)(acc);
              }
              ;
              if (isOp(v.value0) && v.value0 === "?") {
                var $55 = eq16(at(i + 1 | 0))(new Just("?"));
                if ($55) {
                  $tco_done5 = true;
                  return op2("??")(i)(acc);
                }
                ;
                var $56 = eq16(at(i + 1 | 0))(new Just(":"));
                if ($56) {
                  $tco_done5 = true;
                  return op2("?:")(i)(acc);
                }
                ;
                $tco_done5 = true;
                return op1("?")(i)(acc);
              }
              ;
              if (isOp(v.value0)) {
                $tco_done5 = true;
                return op1(singleton5(v.value0))(i)(acc);
              }
              ;
              if (isDigit2(v.value0)) {
                $tco_done5 = true;
                return readNumber(i)(acc);
              }
              ;
              if (identChar(v.value0)) {
                $tco_done5 = true;
                return readIdent(i)(acc);
              }
              ;
              if (otherwise) {
                $tco_done5 = true;
                return bad(i);
              }
              ;
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Token (line 64, column 19 - line 103, column 31): " + [v.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Token (line 61, column 3 - line 61, column 68): " + [i.constructor.name, acc.constructor.name]);
        }
        ;
        while (!$tco_done5) {
          $tco_result = $tco_loop($tco_var_i, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
    return go(0)([]);
  };
};

// output/MaxBars.Lexer/index.js
var eq17 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var notEq7 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var fromFoldable15 = /* @__PURE__ */ fromFoldable(foldableList);
var eq34 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var map30 = /* @__PURE__ */ map(functorEither);
var elem17 = /* @__PURE__ */ elem2(eqString);
var RContent2 = /* @__PURE__ */ (function() {
  function RContent4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RContent4.create = function(value0) {
    return function(value1) {
      return new RContent4(value0, value1);
    };
  };
  return RContent4;
})();
var RAmp2 = /* @__PURE__ */ (function() {
  function RAmp4(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RAmp4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RAmp4(value0, value1, value2, value3);
        };
      };
    };
  };
  return RAmp4;
})();
var ROpen2 = /* @__PURE__ */ (function() {
  function ROpen4(value0, value1, value2, value3, value4) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
  }
  ;
  ROpen4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return new ROpen4(value0, value1, value2, value3, value4);
          };
        };
      };
    };
  };
  return ROpen4;
})();
var RClose2 = /* @__PURE__ */ (function() {
  function RClose4(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RClose4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RClose4(value0, value1, value2, value3);
        };
      };
    };
  };
  return RClose4;
})();
var RSep3 = /* @__PURE__ */ (function() {
  function RSep5(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RSep5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RSep5(value0, value1, value2, value3);
        };
      };
    };
  };
  return RSep5;
})();
var RRaw3 = /* @__PURE__ */ (function() {
  function RRaw5(value0, value1, value2, value3, value4, value5) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
    this.value5 = value5;
  }
  ;
  RRaw5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return function(value5) {
              return new RRaw5(value0, value1, value2, value3, value4, value5);
            };
          };
        };
      };
    };
  };
  return RRaw5;
})();
var RComment2 = /* @__PURE__ */ (function() {
  function RComment4(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RComment4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RComment4(value0, value1, value2);
      };
    };
  };
  return RComment4;
})();
var RError2 = /* @__PURE__ */ (function() {
  function RError4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RError4.create = function(value0) {
    return function(value1) {
      return new RError4(value0, value1);
    };
  };
  return RError4;
})();
var slice4 = function(cs) {
  return function(i) {
    return function(j) {
      return fromCharArray(slice(i)(j)(cs));
    };
  };
};
var nlIndex2 = function(first) {
  return function(s) {
    var f = (function() {
      if (first) {
        return findIndex;
      }
      ;
      return findLastIndex;
    })();
    return f(function(v) {
      return v === "\n";
    })(toCharArray(s));
  };
};
var matchAt3 = function(cs) {
  return function(i) {
    return function(pat) {
      var pcs = toCharArray(pat);
      return eq17(slice(i)(i + length(pcs) | 0)(cs))(pcs);
    };
  };
};
var isStmtSep = function(h) {
  return h === "else" || (h === "elif" || h === "when");
};
var isStmtClose = function(h) {
  return take2(3)(h) === "end" && length2(h) > 3;
};
var isSpace4 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var sepHead2 = function(s) {
  var cs = dropWhile(isSpace4)(toCharArray(s));
  return fromCharArray(takeWhile(function($357) {
    return !isSpace4($357);
  })(cs));
};
var trimEndWs2 = function(s) {
  return fromCharArray(reverse(dropWhile(isSpace4)(reverse(toCharArray(s)))));
};
var trimStartWs2 = function(s) {
  return fromCharArray(dropWhile(isSpace4)(toCharArray(s)));
};
var hasNL2 = function(s) {
  return notEq7(nlIndex2(true)(s))(Nothing.value);
};
var firstWord2 = function(s) {
  return fromCharArray(takeWhile(function($358) {
    return !isSpace4($358);
  })(dropWhile(isSpace4)(toCharArray(s))));
};
var findFrom3 = function(cs) {
  return function(from2) {
    return function(pat) {
      var len = length(cs);
      var go = function($copy_i) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i) {
          if (i > len) {
            $tco_done = true;
            return Nothing.value;
          }
          ;
          if (matchAt3(cs)(i)(pat)) {
            $tco_done = true;
            return new Just(i);
          }
          ;
          if (otherwise) {
            $copy_i = i + 1 | 0;
            return;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 109, column 3 - line 112, column 29): " + [i.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_i);
        }
        ;
        return $tco_result;
      };
      return go(from2);
    };
  };
};
var tokenizeTemplate2 = function(cfg) {
  return function(src) {
    var trimMark = (function() {
      if (cfg.statementTags) {
        return "-";
      }
      ;
      return "~";
    })();
    var splitTrims = function(raw) {
      var trimL = take2(1)(raw) === trimMark;
      var r1 = (function() {
        if (trimL) {
          return drop2(1)(raw);
        }
        ;
        return raw;
      })();
      var trimR = takeRight(1)(r1) === trimMark;
      var core = (function() {
        if (trimR) {
          return dropRight(1)(r1);
        }
        ;
        return r1;
      })();
      return {
        trimL,
        trimR,
        core
      };
    };
    var rawName = function(s) {
      return fromCharArray(takeWhile(function($359) {
        return !isSpace4($359);
      })(dropWhile(isSpace4)(toCharArray(s))));
    };
    var interiorAt = function(base) {
      return function(s) {
        return tokenizeInterior2(base)(s);
      };
    };
    var flush = function(span2) {
      return function(s0) {
        return function(acc) {
          return function(pend) {
            return function(trimR) {
              var s1 = (function() {
                if (pend) {
                  return trimStartWs2(s0);
                }
                ;
                return s0;
              })();
              var s2 = (function() {
                if (trimR) {
                  return trimEndWs2(s1);
                }
                ;
                return s1;
              })();
              var $181 = s2 === "";
              if ($181) {
                return acc;
              }
              ;
              return new Cons(new RContent2(span2, s2), acc);
            };
          };
        };
      };
    };
    var finalize = function($360) {
      return fromFoldable15(reverse2($360));
    };
    var cs = toCharArray(src);
    var leadTrimAt = function(i) {
      return matchAt3(cs)(i + 2 | 0)(trimMark);
    };
    var len = length(cs);
    var findClose = function(from2) {
      return function(close) {
        var skipString = function($copy_j) {
          return function($copy_q) {
            var $tco_var_j = $copy_j;
            var $tco_done = false;
            var $tco_result;
            function $tco_loop(j, q) {
              if (j >= len) {
                $tco_done = true;
                return j;
              }
              ;
              if (eq34(index(cs)(j))(new Just("\\"))) {
                $tco_var_j = j + 2 | 0;
                $copy_q = q;
                return;
              }
              ;
              if (eq34(index(cs)(j))(new Just(q))) {
                $tco_done = true;
                return j + 1 | 0;
              }
              ;
              if (otherwise) {
                $tco_var_j = j + 1 | 0;
                $copy_q = q;
                return;
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Lexer (line 350, column 5 - line 354, column 41): " + [j.constructor.name, q.constructor.name]);
            }
            ;
            while (!$tco_done) {
              $tco_result = $tco_loop($tco_var_j, $copy_q);
            }
            ;
            return $tco_result;
          };
        };
        var scan = function($copy_i) {
          return function($copy_depth) {
            var $tco_var_i = $copy_i;
            var $tco_done1 = false;
            var $tco_result;
            function $tco_loop(i, depth) {
              if (i >= len) {
                $tco_done1 = true;
                return Nothing.value;
              }
              ;
              if (depth === 0 && matchAt3(cs)(i)(close)) {
                $tco_done1 = true;
                return new Just(i);
              }
              ;
              if (otherwise) {
                var v = index(cs)(i);
                if (v instanceof Just && v.value0 === '"') {
                  $tco_var_i = skipString(i + 1 | 0)('"');
                  $copy_depth = depth;
                  return;
                }
                ;
                if (v instanceof Just && v.value0 === "'") {
                  $tco_var_i = skipString(i + 1 | 0)("'");
                  $copy_depth = depth;
                  return;
                }
                ;
                if (v instanceof Just && v.value0 === "{") {
                  $tco_var_i = i + 1 | 0;
                  $copy_depth = depth + 1 | 0;
                  return;
                }
                ;
                if (v instanceof Just && v.value0 === "}") {
                  $tco_var_i = i + 1 | 0;
                  $copy_depth = (function() {
                    var $190 = depth > 0;
                    if ($190) {
                      return depth - 1 | 0;
                    }
                    ;
                    return 0;
                  })();
                  return;
                }
                ;
                $tco_var_i = i + 1 | 0;
                $copy_depth = depth;
                return;
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Lexer (line 341, column 5 - line 349, column 34): " + [i.constructor.name, depth.constructor.name]);
            }
            ;
            while (!$tco_done1) {
              $tco_result = $tco_loop($tco_var_i, $copy_depth);
            }
            ;
            return $tco_result;
          };
        };
        return scan(from2)(0);
      };
    };
    var openerLiteralAt = function(i) {
      if (matchAt3(cs)(i)("{{{{#")) {
        return new Just("{{{{#");
      }
      ;
      if (matchAt3(cs)(i)("{{{{")) {
        return new Just("{{{{");
      }
      ;
      if (matchAt3(cs)(i)("{{~!--")) {
        return new Just("{{~!--");
      }
      ;
      if (matchAt3(cs)(i)("{{!--")) {
        return new Just("{{!--");
      }
      ;
      if (matchAt3(cs)(i)("{{{^")) {
        return new Just("{{{^");
      }
      ;
      if (matchAt3(cs)(i)("{{{/")) {
        return new Just("{{{/");
      }
      ;
      if (matchAt3(cs)(i)("{{{")) {
        return new Just("{{{");
      }
      ;
      if (matchAt3(cs)(i)("{{~!")) {
        return new Just("{{~!");
      }
      ;
      if (matchAt3(cs)(i)("{{!")) {
        return new Just("{{!");
      }
      ;
      if (matchAt3(cs)(i)("{{~#")) {
        return new Just("{{~#");
      }
      ;
      if (matchAt3(cs)(i)("{{#")) {
        return new Just("{{#");
      }
      ;
      if (matchAt3(cs)(i)("{{~^")) {
        return new Just("{{~^");
      }
      ;
      if (matchAt3(cs)(i)("{{^")) {
        return new Just("{{^");
      }
      ;
      if (matchAt3(cs)(i)("{{~<")) {
        return new Just("{{~<");
      }
      ;
      if (matchAt3(cs)(i)("{{<")) {
        return new Just("{{<");
      }
      ;
      if (matchAt3(cs)(i)("{{~$")) {
        return new Just("{{~$");
      }
      ;
      if (matchAt3(cs)(i)("{{$")) {
        return new Just("{{$");
      }
      ;
      if (matchAt3(cs)(i)("{{~/")) {
        return new Just("{{~/");
      }
      ;
      if (matchAt3(cs)(i)("{{/")) {
        return new Just("{{/");
      }
      ;
      if (matchAt3(cs)(i)("{{~&")) {
        return new Just("{{~&");
      }
      ;
      if (matchAt3(cs)(i)("{{&")) {
        return new Just("{{&");
      }
      ;
      if (otherwise) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 495, column 3 - line 495, column 41): " + [i.constructor.name]);
    };
    var isSeparatorAt = function(i) {
      return matchAt3(cs)(i)("{{") && (!matchAt3(cs)(i)("{{{") && (function() {
        var v = openerLiteralAt(i);
        if (v instanceof Just) {
          return false;
        }
        ;
        if (v instanceof Nothing) {
          return true;
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Lexer (line 524, column 70 - line 526, column 20): " + [v.constructor.name]);
      })());
    };
    var escapedOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        var $197 = isSeparatorAt(i);
        if ($197) {
          return new Just("{{");
        }
        ;
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 535, column 23 - line 537, column 62): " + [v.constructor.name]);
    };
    var isOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return true;
      }
      ;
      if (v instanceof Nothing) {
        return isSeparatorAt(i);
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 529, column 18 - line 531, column 31): " + [v.constructor.name]);
    };
    var pushSeg = function(segStart) {
      return function(frags) {
        return function(end) {
          return function(lit) {
            return snoc(snoc(frags)(slice4(cs)(segStart)(end)))(lit);
          };
        };
      };
    };
    var readInlineComment = function(i) {
      var start = i + 2 | 0;
      var v = findFrom3(cs)(start)("#}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedComment(i));
      }
      ;
      if (v instanceof Just) {
        return new Right({
          mtok: new Just(new RComment2({
            start: i,
            end: v.value0 + 2 | 0
          }, start, slice4(cs)(start)(v.value0))),
          next: v.value0 + 2 | 0,
          trimL: false,
          trimR: false
        });
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 615, column 7 - line 623, column 14): " + [v.constructor.name]);
    };
    var readRaw = function(i) {
      return function(sigil) {
        var start = i + sigil | 0;
        var v = findFrom3(cs)(start)("}}}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedRaw(i));
        }
        ;
        if (v instanceof Just) {
          var head4 = slice4(cs)(start)(v.value0);
          var closePat = "{{{{/" + (rawName(head4) + "}}}}");
          var bodyStart2 = v.value0 + 4 | 0;
          var v1 = findFrom3(cs)(bodyStart2)(closePat);
          if (v1 instanceof Nothing) {
            return new Left(new UnterminatedRaw(i));
          }
          ;
          if (v1 instanceof Just) {
            var end = v1.value0 + length2(closePat) | 0;
            return new Right({
              mtok: new Just(new RRaw3({
                start: i,
                end
              }, sigil === 5, start, head4, interiorAt(start)(head4), slice4(cs)(bodyStart2)(v1.value0))),
              next: end,
              trimL: false,
              trimR: false
            });
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 827, column 13 - line 841, column 22): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Lexer (line 816, column 7 - line 841, column 22): " + [v.constructor.name]);
      };
    };
    var contentTo = function(segStart) {
      return function(frags) {
        return function(end) {
          return joinWith("")(snoc(frags)(slice4(cs)(segStart)(end)));
        };
      };
    };
    var consTok = function(mtok) {
      return function(acc1) {
        return maybe(acc1)(function(t) {
          return new Cons(t, acc1);
        })(mtok);
      };
    };
    var closeFrom = function(from2) {
      return function(close) {
        return findClose(from2)(close);
      };
    };
    var findEndrawFrom = /* @__PURE__ */ (function() {
      var scan = function($copy_j) {
        var $tco_done2 = false;
        var $tco_result;
        function $tco_loop(j) {
          if (j >= len) {
            $tco_done2 = true;
            return Nothing.value;
          }
          ;
          if (matchAt3(cs)(j)("{%")) {
            var v = closeFrom(j + 2 | 0)("%}");
            if (v instanceof Just) {
              if (firstWord2(splitTrims(slice4(cs)(j + 2 | 0)(v.value0)).core) === "endraw") {
                $tco_done2 = true;
                return new Just({
                  tagStart: j,
                  tagEnd: v.value0 + 2 | 0
                });
              }
              ;
              if (otherwise) {
                $copy_j = v.value0 + 2 | 0;
                return;
              }
              ;
            }
            ;
            if (v instanceof Nothing) {
              $copy_j = j + 1 | 0;
              return;
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Lexer (line 801, column 29 - line 806, column 34): " + [v.constructor.name]);
          }
          ;
          if (otherwise) {
            $copy_j = j + 1 | 0;
            return;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 799, column 5 - line 807, column 33): " + [j.constructor.name]);
        }
        ;
        while (!$tco_done2) {
          $tco_result = $tco_loop($copy_j);
        }
        ;
        return $tco_result;
      };
      return scan;
    })();
    var readRawBody = function(i) {
      return function(headStart) {
        return function(bodyStart2) {
          var v = findEndrawFrom(bodyStart2);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedRaw(i));
          }
          ;
          if (v instanceof Just) {
            return new Right({
              mtok: new Just(new RRaw3({
                start: i,
                end: v.value0.tagEnd
              }, true, headStart, "raw", interiorAt(headStart)("raw"), slice4(cs)(bodyStart2)(v.value0.tagStart))),
              next: v.value0.tagEnd,
              trimL: leadTrimAt(i),
              trimR: false
            });
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 780, column 39 - line 791, column 8): " + [v.constructor.name]);
        };
      };
    };
    var readAmp = function(i) {
      return function(opener) {
        var start = i + length2(opener) | 0;
        var v = closeFrom(start)("}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedTag(i));
        }
        ;
        if (v instanceof Just) {
          var t = splitTrims(slice4(cs)(start)(v.value0));
          return new Right({
            mtok: new Just(new RAmp2({
              start: i,
              end: v.value0 + 2 | 0
            }, start, t.core, interiorAt(start)(t.core))),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i) || t.trimL,
            trimR: t.trimR
          });
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Lexer (line 675, column 7 - line 686, column 16): " + [v.constructor.name]);
      };
    };
    var readBlockOpen = function(i) {
      return function(opener) {
        return function(sigil) {
          return function(close) {
            var start = i + length2(opener) | 0;
            var cl = length2(close);
            var v = closeFrom(start)(close);
            if (v instanceof Nothing) {
              return new Left(new UnterminatedTag(i));
            }
            ;
            if (v instanceof Just) {
              var t = splitTrims(slice4(cs)(start)(v.value0));
              return new Right({
                mtok: new Just(new ROpen2({
                  start: i,
                  end: v.value0 + cl | 0
                }, sigil, start, t.core, interiorAt(start)(t.core))),
                next: v.value0 + cl | 0,
                trimL: leadTrimAt(i) || t.trimL,
                trimR: t.trimR
              });
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Lexer (line 634, column 7 - line 646, column 16): " + [v.constructor.name]);
          };
        };
      };
    };
    var readClose = function(i) {
      return function(opener) {
        return function(close) {
          var start = i + length2(opener) | 0;
          var cl = length2(close);
          var v = closeFrom(start)(close);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedTag(i));
          }
          ;
          if (v instanceof Just) {
            var t = splitTrims(slice4(cs)(start)(v.value0));
            return new Right({
              mtok: new Just(new RClose2({
                start: i,
                end: v.value0 + cl | 0
              }, start, t.core, interiorAt(start)(t.core))),
              next: v.value0 + cl | 0,
              trimL: leadTrimAt(i) || t.trimL,
              trimR: t.trimR
            });
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 656, column 7 - line 667, column 16): " + [v.constructor.name]);
        };
      };
    };
    var readSeparator = function(i) {
      var start = (function() {
        var $217 = leadTrimAt(i);
        if ($217) {
          return i + 3 | 0;
        }
        ;
        return i + 2 | 0;
      })();
      var v = closeFrom(start)("}}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice4(cs)(start)(v.value0));
        return new Right({
          mtok: new Just(new RSep3({
            start: i,
            end: v.value0 + 2 | 0
          }, start, t.core, interiorAt(start)(t.core))),
          next: v.value0 + 2 | 0,
          trimL: leadTrimAt(i) || t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 696, column 7 - line 707, column 16): " + [v.constructor.name]);
    };
    var readTag = function(i) {
      if (matchAt3(cs)(i)("{{{{#")) {
        return readRaw(i)(5);
      }
      ;
      if (matchAt3(cs)(i)("{{{{")) {
        return readRaw(i)(4);
      }
      ;
      if (matchAt3(cs)(i)("{{{")) {
        return new Left(new LexError("`{{{ \u2026 }}}` is not a tag here \u2014 unescaped output is `{{ x | safe }}`, a verbatim region is `{% raw %}`", i));
      }
      ;
      if (matchAt3(cs)(i)("{{~#*")) {
        return readBlockOpen(i)("{{~#*")(Decorator.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{#*")) {
        return readBlockOpen(i)("{{#*")(Decorator.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~#>")) {
        return readBlockOpen(i)("{{~#>")(PartialBlock.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{#>")) {
        return readBlockOpen(i)("{{#>")(PartialBlock.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~#")) {
        return readBlockOpen(i)("{{~#")(Section.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{#")) {
        return readBlockOpen(i)("{{#")(Section.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~^")) {
        return readBlockOpen(i)("{{~^")(Inverse.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{^")) {
        return readBlockOpen(i)("{{^")(Inverse.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~<")) {
        return readBlockOpen(i)("{{~<")(Parent.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{<")) {
        return readBlockOpen(i)("{{<")(Parent.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~$")) {
        return readBlockOpen(i)("{{~$")(BlockDef.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{$")) {
        return readBlockOpen(i)("{{$")(BlockDef.value)("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~/")) {
        return readClose(i)("{{~/")("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{/")) {
        return readClose(i)("{{/")("}}");
      }
      ;
      if (matchAt3(cs)(i)("{{~&")) {
        return readAmp(i)("{{~&");
      }
      ;
      if (matchAt3(cs)(i)("{{&")) {
        return readAmp(i)("{{&");
      }
      ;
      if (matchAt3(cs)(i)("{{")) {
        return readSeparator(i);
      }
      ;
      if (otherwise) {
        return new Left(new LexError("internal: no opener", i));
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 539, column 3 - line 539, column 48): " + [i.constructor.name]);
    };
    var readStatementTag = function(i) {
      var start = (function() {
        var $221 = leadTrimAt(i);
        if ($221) {
          return i + 3 | 0;
        }
        ;
        return i + 2 | 0;
      })();
      var v = closeFrom(start)("%}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice4(cs)(start)(v.value0));
        var span2 = {
          start: i,
          end: v.value0 + 2 | 0
        };
        var mk = function(tok) {
          return new Right({
            mtok: new Just(tok),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i) || t.trimL,
            trimR: t.trimR
          });
        };
        var headWord4 = firstWord2(t.core);
        var $223 = headWord4 === "";
        if ($223) {
          return new Left(new LexError("empty statement tag '{% %}'", i));
        }
        ;
        var $224 = trim(t.core) === "raw";
        if ($224) {
          return readRawBody(i)(start)(v.value0 + 2 | 0);
        }
        ;
        var $225 = isStmtClose(headWord4);
        if ($225) {
          var name2 = drop2(3)(headWord4);
          return mk(new RClose2(span2, start, name2, interiorAt(start)(name2)));
        }
        ;
        var $226 = isStmtSep(headWord4) || (headWord4 === "set" || (trim(t.core) === "yield" || trim(t.core) === "super"));
        if ($226) {
          return mk(new RSep3(span2, start, t.core, interiorAt(start)(t.core)));
        }
        ;
        var $227 = headWord4 === "extends";
        if ($227) {
          return mk(new RSep3(span2, start, t.core, interiorAt(start)(t.core)));
        }
        ;
        var $228 = headWord4 === "include";
        if ($228) {
          var skipSp = function($copy_j) {
            var $tco_done3 = false;
            var $tco_result;
            function $tco_loop(j) {
              var $229 = j < v.value0 && maybe(false)(isSpace4)(index(cs)(j));
              if ($229) {
                $copy_j = j + 1 | 0;
                return;
              }
              ;
              $tco_done3 = true;
              return j;
            }
            ;
            while (!$tco_done3) {
              $tco_result = $tco_loop($copy_j);
            }
            ;
            return $tco_result;
          };
          var argsOff = skipSp(skipSp(start) + length2(headWord4) | 0);
          var pcore = "> " + slice4(cs)(argsOff)(v.value0);
          return mk(new RSep3(span2, start, pcore, interiorAt(argsOff - 2 | 0)(pcore)));
        }
        ;
        return mk(new ROpen2(span2, Section.value, start, t.core, interiorAt(start)(t.core)));
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Lexer (line 719, column 7 - line 773, column 73): " + [v.constructor.name]);
    };
    var recoverFrom = function(i) {
      return function(e) {
        return function(segStart) {
          return function(frags) {
            return function(acc) {
              return function(pend) {
                return function(open) {
                  return function(close) {
                    var resync = fromMaybe(len)(findFrom3(cs)(i + length2(open) | 0)(open));
                    var acc2 = new Cons(new RError2({
                      start: i,
                      end: resync
                    }, e), flush({
                      start: segStart,
                      end: i
                    })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                    return go(resync)(open)(close)(resync)([])(acc2)(false);
                  };
                };
              };
            };
          };
        };
      };
    };
    var go = function($copy_i) {
      return function($copy_open) {
        return function($copy_close) {
          return function($copy_segStart) {
            return function($copy_frags) {
              return function($copy_acc) {
                return function($copy_pend) {
                  var $tco_var_i = $copy_i;
                  var $tco_var_open = $copy_open;
                  var $tco_var_close = $copy_close;
                  var $tco_var_segStart = $copy_segStart;
                  var $tco_var_frags = $copy_frags;
                  var $tco_var_acc = $copy_acc;
                  var $tco_done4 = false;
                  var $tco_result;
                  function $tco_loop(i, open, close, segStart, frags, acc, pend) {
                    if (i >= len) {
                      $tco_done4 = true;
                      return new Right(flush({
                        start: segStart,
                        end: i
                      })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                    }
                    ;
                    if (otherwise) {
                      var v = index(cs)(i);
                      if (v instanceof Nothing) {
                        $tco_done4 = true;
                        return new Right(flush({
                          start: segStart,
                          end: i
                        })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                      }
                      ;
                      if (v instanceof Just) {
                        if (matchAt3(cs)(i)("{%")) {
                          var v1 = readStatementTag(i);
                          if (v1 instanceof Left) {
                            $tco_done4 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = acc2;
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at MaxBars.Lexer (line 389, column 34 - line 398, column 68): " + [v1.constructor.name]);
                        }
                        ;
                        if (matchAt3(cs)(i)("{#")) {
                          var v1 = readInlineComment(i);
                          if (v1 instanceof Left) {
                            $tco_done4 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = acc2;
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at MaxBars.Lexer (line 403, column 34 - line 412, column 68): " + [v1.constructor.name]);
                        }
                        ;
                        if (v.value0 === "\\") {
                          var $245 = matchAt3(cs)(i + 1 | 0)("\\");
                          if ($245) {
                            $tco_var_i = i + 2 | 0;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = i + 2 | 0;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)("\\");
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          var v1 = escapedOpenerAt(i + 1 | 0);
                          if (v1 instanceof Just) {
                            var next = (i + 1 | 0) + length2(v1.value0) | 0;
                            $tco_var_i = next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = next;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)(v1.value0);
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          if (v1 instanceof Nothing) {
                            $tco_var_i = i + 1 | 0;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = i + 1 | 0;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)("\\");
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at MaxBars.Lexer (line 421, column 20 - line 427, column 98): " + [v1.constructor.name]);
                        }
                        ;
                        if (v.value0 === "{" && isOpenerAt(i)) {
                          var v1 = readTag(i);
                          if (v1 instanceof Left) {
                            $tco_done4 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = acc2;
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at MaxBars.Lexer (line 428, column 41 - line 437, column 68): " + [v1.constructor.name]);
                        }
                        ;
                        if (otherwise) {
                          $tco_var_i = i + 1 | 0;
                          $tco_var_open = open;
                          $tco_var_close = close;
                          $tco_var_segStart = segStart;
                          $tco_var_frags = frags;
                          $tco_var_acc = acc;
                          $copy_pend = pend;
                          return;
                        }
                        ;
                      }
                      ;
                      throw new Error("Failed pattern match at MaxBars.Lexer (line 382, column 19 - line 438, column 71): " + [v.constructor.name]);
                    }
                    ;
                    throw new Error("Failed pattern match at MaxBars.Lexer (line 370, column 3 - line 378, column 39): " + [i.constructor.name, open.constructor.name, close.constructor.name, segStart.constructor.name, frags.constructor.name, acc.constructor.name, pend.constructor.name]);
                  }
                  ;
                  while (!$tco_done4) {
                    $tco_result = $tco_loop($tco_var_i, $tco_var_open, $tco_var_close, $tco_var_segStart, $tco_var_frags, $tco_var_acc, $copy_pend);
                  }
                  ;
                  return $tco_result;
                };
              };
            };
          };
        };
      };
    };
    return map30(finalize)(go(0)(cfg.open)(cfg.close)(0)([])(Nil.value)(false));
  };
};
var dropTrailingIndent2 = function(s) {
  var v = nlIndex2(false)(s);
  if (v instanceof Just) {
    return take2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Lexer (line 266, column 24 - line 268, column 16): " + [v.constructor.name]);
};
var dropLeadingLine2 = function(s) {
  var v = nlIndex2(true)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Lexer (line 259, column 21 - line 261, column 16): " + [v.constructor.name]);
};
var defaultLexConfig2 = {
  open: "{{",
  close: "}}",
  statementTags: false
};
var maxLexConfig = /* @__PURE__ */ (function() {
  return {
    open: defaultLexConfig2.open,
    close: defaultLexConfig2.close,
    statementTags: true
  };
})();
var tokenize = /* @__PURE__ */ tokenizeTemplate2(maxLexConfig);
var blockLevel2 = function(v) {
  if (v instanceof ROpen2) {
    return true;
  }
  ;
  if (v instanceof RClose2) {
    return true;
  }
  ;
  if (v instanceof RComment2) {
    return true;
  }
  ;
  return false;
};
var beforeFirstNL2 = function(s) {
  var v = nlIndex2(true)(s);
  if (v instanceof Just) {
    return take2(v.value0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Lexer (line 252, column 19 - line 254, column 15): " + [v.constructor.name]);
};
var allWs2 = /* @__PURE__ */ (function() {
  var $361 = all2(isSpace4);
  return function($362) {
    return $361(toCharArray($362));
  };
})();
var afterLastNL2 = function(s) {
  var v = nlIndex2(false)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Lexer (line 247, column 17 - line 249, column 15): " + [v.constructor.name]);
};
var trimStandalone2 = function(seps) {
  return function(toks) {
    var rightBlank = function(i) {
      var goRight = function($copy_k) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(k) {
          var v = index(toks)(k);
          if (v instanceof Nothing) {
            $tco_done = true;
            return true;
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent2) {
            if (hasNL2(v.value0.value1)) {
              $tco_done = true;
              return allWs2(beforeFirstNL2(v.value0.value1));
            }
            ;
            if (allWs2(v.value0.value1)) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            if (otherwise) {
              $tco_done = true;
              return false;
            }
            ;
          }
          ;
          if (v instanceof Just) {
            $tco_done = true;
            return false;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 207, column 17 - line 213, column 22): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_k);
        }
        ;
        return $tco_result;
      };
      return goRight(i + 1 | 0);
    };
    var leftBlank = function(i) {
      var goLeft = function($copy_k) {
        var $tco_done1 = false;
        var $tco_result;
        function $tco_loop(k) {
          var v = index(toks)(k);
          if (v instanceof Nothing) {
            $tco_done1 = true;
            return true;
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent2) {
            if (hasNL2(v.value0.value1)) {
              $tco_done1 = true;
              return allWs2(afterLastNL2(v.value0.value1));
            }
            ;
            if (allWs2(v.value0.value1)) {
              $copy_k = k - 1 | 0;
              return;
            }
            ;
            if (otherwise) {
              $tco_done1 = true;
              return false;
            }
            ;
          }
          ;
          if (v instanceof Just) {
            $tco_done1 = true;
            return false;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Lexer (line 195, column 16 - line 201, column 22): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done1) {
          $tco_result = $tco_loop($copy_k);
        }
        ;
        return $tco_result;
      };
      return goLeft(i - 1 | 0);
    };
    var eligible2 = function(t) {
      return blockLevel2(t) || (function() {
        if (t instanceof RSep3) {
          return elem17(sepHead2(t.value2))(seps);
        }
        ;
        return false;
      })();
    };
    var standaloneAt = function(i) {
      var v = index(toks)(i);
      if (v instanceof Just && eligible2(v.value0)) {
        return leftBlank(i) && rightBlank(i);
      }
      ;
      return false;
    };
    var trimContent = function(j) {
      return function(v) {
        if (v instanceof RContent2) {
          var s1 = (function() {
            var $353 = standaloneAt(j - 1 | 0);
            if ($353) {
              return dropLeadingLine2(v.value1);
            }
            ;
            return v.value1;
          })();
          var s2 = (function() {
            var $354 = standaloneAt(j + 1 | 0);
            if ($354) {
              return dropTrailingIndent2(s1);
            }
            ;
            return s1;
          })();
          return new RContent2(v.value0, s2);
        }
        ;
        return v;
      };
    };
    return mapWithIndex2(trimContent)(toks);
  };
};

// output/MaxBars.Parser/index.js
var map31 = /* @__PURE__ */ map(functorMaybe);
var elem18 = /* @__PURE__ */ elem2(eqString);
var eq6 = /* @__PURE__ */ eq(eqToken);
var eq35 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var fromFoldable16 = /* @__PURE__ */ fromFoldable(foldableList);
var append6 = /* @__PURE__ */ append(semigroupArray);
var identity11 = /* @__PURE__ */ identity(categoryFn);
var StopEOF2 = /* @__PURE__ */ (function() {
  function StopEOF4() {
  }
  ;
  StopEOF4.value = new StopEOF4();
  return StopEOF4;
})();
var StopClose2 = /* @__PURE__ */ (function() {
  function StopClose4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  StopClose4.create = function(value0) {
    return function(value1) {
      return new StopClose4(value0, value1);
    };
  };
  return StopClose4;
})();
var splitFirstEq2 = function(s) {
  var v = indexOf2("=")(s);
  if (v instanceof Just) {
    return {
      key: take3(v.value0)(s),
      rest: drop3(v.value0 + 1 | 0)(s)
    };
  }
  ;
  if (v instanceof Nothing) {
    return {
      key: s,
      rest: ""
    };
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Parser (line 368, column 18 - line 370, column 34): " + [v.constructor.name]);
};
var sepHeadIsClause = function(seps) {
  return function(v) {
    if (v instanceof Right) {
      var v1 = map31(function(v2) {
        return v2.tok;
      })(head(v.value0));
      if (v1 instanceof Just && v1.value0 instanceof TIdent) {
        return elem18(v1.value0.value0)(seps);
      }
      ;
      return false;
    }
    ;
    if (v instanceof Left) {
      return false;
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Parser (line 281, column 24 - line 285, column 18): " + [v.constructor.name]);
  };
};
var salvageName2 = function(toks) {
  var v = head(toks);
  if (v instanceof Just && v.value0.tok instanceof TIdent) {
    return new Just(v.value0.tok.value0);
  }
  ;
  return Nothing.value;
};
var partialHead2 = function(toks) {
  var v = uncons(toks);
  if (v instanceof Just && eq6(v.value0.head.tok)(new TOp(">"))) {
    return cons({
      at: v.value0.head.at,
      end: v.value0.head.end,
      tok: new TIdent(">")
    })(v.value0.tail);
  }
  ;
  return toks;
};
var parseInlineHead = function(toks) {
  var tokAt = function(i) {
    return map31(function(v3) {
      return v3.tok;
    })(index(toks)(i));
  };
  var gluedLit = function(t) {
    if (t === "true") {
      return new Just(new Lit(new VBool(true)));
    }
    ;
    if (t === "false") {
      return new Just(new Lit(new VBool(false)));
    }
    ;
    if (t === "null") {
      return new Just(new Lit(VNull.value));
    }
    ;
    if (otherwise) {
      return map31(function($219) {
        return Lit.create(VNumber.create($219));
      })(fromString(t));
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Parser (line 360, column 3 - line 364, column 58): " + [t.constructor.name]);
  };
  var litAt = function(i) {
    var v3 = tokAt(i);
    if (v3 instanceof Just && v3.value0 instanceof TStr) {
      return new Just(new Lit(new VString(v3.value0.value0)));
    }
    ;
    if (v3 instanceof Just && v3.value0 instanceof TNum) {
      return new Just(new Lit(new VNumber(v3.value0.value0)));
    }
    ;
    if (v3 instanceof Just && v3.value0 instanceof TIdent) {
      return gluedLit(v3.value0.value0);
    }
    ;
    return Nothing.value;
  };
  var atOf = function(i) {
    return maybe(0)(function(v3) {
      return v3.at;
    })(index(toks)(i));
  };
  var loop = function($copy_i) {
    return function($copy_acc) {
      var $tco_var_i = $copy_i;
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(i, acc) {
        var fail = function(j) {
          return function(msg) {
            return {
              name: new Just("inline"),
              args: acc,
              error: new Just(new LexError(msg, atOf(j)))
            };
          };
        };
        var v3 = tokAt(i);
        if (v3 instanceof Just && v3.value0 instanceof TRParen) {
          $tco_done = true;
          return {
            name: new Just("inline"),
            args: acc,
            error: Nothing.value
          };
        }
        ;
        if (v3 instanceof Just && v3.value0 instanceof TComma) {
          $tco_var_i = i + 1 | 0;
          $copy_acc = acc;
          return;
        }
        ;
        if (v3 instanceof Just && v3.value0 instanceof TIdent) {
          if (contains("=")(v3.value0.value0)) {
            var v12 = splitFirstEq2(v3.value0.value0);
            var $85 = v12.rest === "";
            if ($85) {
              var v22 = litAt(i + 1 | 0);
              if (v22 instanceof Just) {
                $tco_var_i = i + 2 | 0;
                $copy_acc = snoc(acc)(new App2(v12.key, [v22.value0]));
                return;
              }
              ;
              if (v22 instanceof Nothing) {
                $tco_done = true;
                return fail(i + 1 | 0)("inline parameter default must be a literal");
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Parser (line 338, column 32 - line 340, column 83): " + [v22.constructor.name]);
            }
            ;
            var v22 = gluedLit(v12.rest);
            if (v22 instanceof Just) {
              $tco_var_i = i + 1 | 0;
              $copy_acc = snoc(acc)(new App2(v12.key, [v22.value0]));
              return;
            }
            ;
            if (v22 instanceof Nothing) {
              $tco_done = true;
              return fail(i)("inline parameter default must be a literal (quote a string)");
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Parser (line 342, column 18 - line 344, column 94): " + [v22.constructor.name]);
          }
          ;
          if (otherwise) {
            $tco_var_i = i + 1 | 0;
            $copy_acc = snoc(acc)(new App2(v3.value0.value0, []));
            return;
          }
          ;
        }
        ;
        if (v3 instanceof Just) {
          $tco_done = true;
          return fail(i)("unexpected token in inline signature");
        }
        ;
        if (v3 instanceof Nothing) {
          $tco_done = true;
          return fail(i - 1 | 0)("unterminated inline signature \u2014 missing `)`");
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Parser (line 327, column 16 - line 348, column 74): " + [v3.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($tco_var_i, $copy_acc);
      }
      ;
      return $tco_result;
    };
  };
  var v = tokAt(2);
  var v1 = tokAt(1);
  var v2 = tokAt(0);
  if (v2 instanceof Just && (v2.value0 instanceof TIdent && (v2.value0.value0 === "inline" && (v1 instanceof Just && (v1.value0 instanceof TStr && (v instanceof Just && v.value0 instanceof TLParen)))))) {
    return new Just(loop(3)([new Lit(new VString(v1.value0.value0))]));
  }
  ;
  return Nothing.value;
};
var outputExpr2 = function(pe) {
  return function(span2) {
    return function(v) {
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        if ($$null(v.value0)) {
          return new Left(new EmptyOutput(span2.start));
        }
        ;
        if (otherwise) {
          return pe(v.value0);
        }
        ;
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Parser (line 242, column 22 - line 246, column 27): " + [v.constructor.name]);
    };
  };
};
var maxClauseSeps = ["else", "elif", "when"];
var isSpace5 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var isLetter2 = function(c) {
  return c >= "a" && c <= "z" || c >= "A" && c <= "Z";
};
var isKeyChar2 = function(c) {
  return isLetter2(c) || (c >= "0" && c <= "9" || (c === "_" || c === "-"));
};
var parseDirectives2 = function(base) {
  return function(interior) {
    var cs = toCharArray(interior);
    var len = length(cs);
    var slc = function(a) {
      return function(b) {
        return fromCharArray(slice(a)(b)(cs));
      };
    };
    var at = function(k) {
      return index(cs)(k);
    };
    var isHead = function(k) {
      return eq35(at(k))(new Just("@")) && maybe(false)(isLetter2)(at(k + 1 | 0));
    };
    var valueEnd = function($copy_k) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(k) {
        if (k >= len) {
          $tco_done = true;
          return len;
        }
        ;
        if (isHead(k)) {
          $tco_done = true;
          return k;
        }
        ;
        if (otherwise) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Parser (line 190, column 3 - line 193, column 35): " + [k.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var readKey = function($copy_k) {
      var $tco_done1 = false;
      var $tco_result;
      function $tco_loop(k) {
        var $107 = maybe(false)(isKeyChar2)(at(k));
        if ($107) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        $tco_done1 = true;
        return k;
      }
      ;
      while (!$tco_done1) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var skipWs = function($copy_k) {
      var $tco_done2 = false;
      var $tco_result;
      function $tco_loop(k) {
        var $108 = maybe(false)(isSpace5)(at(k));
        if ($108) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        $tco_done2 = true;
        return k;
      }
      ;
      while (!$tco_done2) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var go = function($copy_j) {
      return function($copy_acc) {
        var $tco_var_j = $copy_j;
        var $tco_done3 = false;
        var $tco_result;
        function $tco_loop(j, acc) {
          if (j >= len) {
            $tco_done3 = true;
            return acc;
          }
          ;
          if (isHead(j)) {
            var keyEnd = readKey(j + 1 | 0);
            var key = slc(j + 1 | 0)(keyEnd);
            var afterKey = skipWs(keyEnd);
            var v = at(afterKey);
            if (v instanceof Just && v.value0 === ":") {
              var vStart = skipWs(afterKey + 1 | 0);
              var vEnd = valueEnd(vStart);
              var dir = {
                key,
                value: trim(slc(vStart)(vEnd)),
                span: {
                  start: base + j | 0,
                  end: base + vEnd | 0
                }
              };
              $tco_var_j = vEnd;
              $copy_acc = snoc(acc)(dir);
              return;
            }
            ;
            var dir = {
              key,
              value: "true",
              span: {
                start: base + j | 0,
                end: base + keyEnd | 0
              }
            };
            $tco_var_j = keyEnd;
            $copy_acc = snoc(acc)(dir);
            return;
          }
          ;
          if (otherwise) {
            $tco_var_j = j + 1 | 0;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Parser (line 195, column 3 - line 195, column 50): " + [j.constructor.name, acc.constructor.name]);
        }
        ;
        while (!$tco_done3) {
          $tco_result = $tco_loop($tco_var_j, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
    return go(0)([]);
  };
};
var isComment2 = function(v) {
  if (v instanceof RComment2) {
    return true;
  }
  ;
  return false;
};
var headedRecovering2 = function(pe) {
  return function(span2) {
    return function(v) {
      if (v instanceof Left) {
        return {
          name: Nothing.value,
          args: [],
          error: new Just(v.value0)
        };
      }
      ;
      if (v instanceof Right && $$null(v.value0)) {
        return {
          name: Nothing.value,
          args: [],
          error: new Just(new HeadNotIdent(span2.start))
        };
      }
      ;
      var v1 = function(v2) {
        if (v instanceof Right && otherwise) {
          var v3 = pe(partialHead2(v.value0));
          if (v3 instanceof Right && v3.value0 instanceof App2) {
            return {
              name: new Just(v3.value0.value0),
              args: v3.value0.value1,
              error: Nothing.value
            };
          }
          ;
          if (v3 instanceof Right) {
            return {
              name: Nothing.value,
              args: [],
              error: new Just(new HeadNotIdent(span2.start))
            };
          }
          ;
          if (v3 instanceof Left) {
            return {
              name: salvageName2(partialHead2(v.value0)),
              args: [],
              error: new Just(v3.value0)
            };
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Parser (line 306, column 20 - line 309, column 84): " + [v3.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Parser (line 292, column 1 - line 296, column 77): " + [v.constructor.name]);
      };
      if (v instanceof Right) {
        var $129 = parseInlineHead(v.value0);
        if ($129 instanceof Just) {
          return $129.value0;
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
};
var headed2 = function(pe) {
  return function(span2) {
    return function(v) {
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        if ($$null(v.value0)) {
          return new Left(new HeadNotIdent(span2.start));
        }
        ;
        if (otherwise) {
          var v1 = pe(partialHead2(v.value0));
          if (v1 instanceof Left) {
            return new Left(v1.value0);
          }
          ;
          if (v1 instanceof Right && v1.value0 instanceof App2) {
            return new Right({
              name: v1.value0.value0,
              args: v1.value0.value1
            });
          }
          ;
          if (v1 instanceof Right) {
            return new Left(new HeadNotIdent(span2.start));
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Parser (line 259, column 20 - line 262, column 50): " + [v1.constructor.name]);
        }
        ;
      }
      ;
      throw new Error("Failed pattern match at MaxBars.Parser (line 255, column 18 - line 262, column 50): " + [v.constructor.name]);
    };
  };
};
var parseSeq2 = function(toks) {
  var done = function(acc) {
    return function(errs) {
      return function(stop) {
        return {
          nodes: fromFoldable16(reverse2(acc)),
          stop,
          errors: errs
        };
      };
    };
  };
  var recover = function(acc) {
    return function(errs) {
      return function(sp) {
        return function(e) {
          return function(next) {
            return go(new Cons(new NodeError(sp, parseErrorMessage(e)), acc))(snoc(errs)(e))(next);
          };
        };
      };
    };
  };
  var go = function($copy_acc) {
    return function($copy_errs) {
      return function($copy_i) {
        var $tco_var_acc = $copy_acc;
        var $tco_var_errs = $copy_errs;
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(acc, errs, i) {
          var v = index(toks)(i);
          if (v instanceof Nothing) {
            $tco_done = true;
            return done(acc)(errs)(StopEOF2.value);
          }
          ;
          if (v instanceof Just) {
            if (v.value0 instanceof RContent2) {
              $tco_var_acc = new Cons(new Content(v.value0.value0, v.value0.value1), acc);
              $tco_var_errs = errs;
              $copy_i = i + 1 | 0;
              return;
            }
            ;
            if (v.value0 instanceof RComment2) {
              $tco_var_acc = acc;
              $tco_var_errs = errs;
              $copy_i = i + 1 | 0;
              return;
            }
            ;
            if (v.value0 instanceof RError2) {
              $tco_done = true;
              return recover(acc)(errs)(v.value0.value0)(v.value0.value1)(i + 1 | 0);
            }
            ;
            if (v.value0 instanceof RAmp2) {
              $tco_done = true;
              return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{& }} (unescaped output)", v.value0.value0.start))(i + 1 | 0);
            }
            ;
            if (v.value0 instanceof RRaw3) {
              if (!v.value0.value1) {
                $tco_done = true;
                return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{{{ }}}} (raw block)", v.value0.value0.start))(i + 1 | 0);
              }
              ;
              if (otherwise) {
                var v1 = headed2(parseMaxExpr)(v.value0.value0)(v.value0.value4);
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                if (v1 instanceof Right) {
                  $tco_var_acc = new Cons(new RawBlock(v.value0.value0, v1.value0.name, v1.value0.args, v.value0.value5), acc);
                  $tco_var_errs = errs;
                  $copy_i = i + 1 | 0;
                  return;
                }
                ;
                throw new Error("Failed pattern match at MaxBars.Parser (line 444, column 24 - line 446, column 80): " + [v1.constructor.name]);
              }
              ;
            }
            ;
            if (v.value0 instanceof RSep3) {
              var hp = (function() {
                var $163 = sepHeadIsClause(maxClauseSeps)(v.value0.value3);
                if ($163) {
                  return parseMaxHead;
                }
                ;
                return parseMaxExpr;
              })();
              var v1 = headed2(hp)(v.value0.value0)(v.value0.value3);
              if (v1 instanceof Right) {
                $tco_var_acc = new Cons(new Sep(v.value0.value0, v1.value0.name, v1.value0.args), acc);
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v1 instanceof Left && (v1.value0 instanceof HeadNotIdent && trim(v.value0.value2) !== "")) {
                var v2 = outputExpr2(parseMaxExpr)(v.value0.value0)(v.value0.value3);
                if (v2 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v2.value0)(i + 1 | 0);
                }
                ;
                if (v2 instanceof Right) {
                  $tco_var_acc = new Cons(new Output(v.value0.value0, v2.value0), acc);
                  $tco_var_errs = errs;
                  $copy_i = i + 1 | 0;
                  return;
                }
                ;
                throw new Error("Failed pattern match at MaxBars.Parser (line 463, column 33 - line 465, column 67): " + [v2.constructor.name]);
              }
              ;
              if (v1 instanceof Left) {
                $tco_done = true;
                return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Parser (line 456, column 11 - line 466, column 54): " + [v1.constructor.name]);
            }
            ;
            if (v.value0 instanceof RClose2) {
              var v1 = headed2(parseMaxExpr)({
                start: v.value0.value1,
                end: v.value0.value1
              })(v.value0.value3);
              if (v1 instanceof Left) {
                $tco_done = true;
                return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
              }
              ;
              if (v1 instanceof Right) {
                $tco_done = true;
                return done(acc)(errs)(new StopClose2(v1.value0.name, i + 1 | 0));
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Parser (line 467, column 33 - line 471, column 60): " + [v1.constructor.name]);
            }
            ;
            if (v.value0 instanceof ROpen2) {
              if (v.value0.value1 instanceof Section) {
                $tco_done = true;
                return buildBlock(acc)(errs)(Nothing.value)(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
              }
              ;
              if (v.value0.value1 instanceof Inverse) {
                $tco_done = true;
                return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{^ }} (inverse block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
              }
              ;
              if (v.value0.value1 instanceof Parent) {
                $tco_done = true;
                return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{< }} (parent block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
              }
              ;
              if (v.value0.value1 instanceof BlockDef) {
                $tco_done = true;
                return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{$ }} (override block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
              }
              ;
              if (v.value0.value1 instanceof Decorator) {
                $tco_done = true;
                return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{#* }} (inline-partial decorator)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
              }
              ;
              if (v.value0.value1 instanceof PartialBlock) {
                $tco_done = true;
                return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{#> }} (partial block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
              }
              ;
              throw new Error("Failed pattern match at MaxBars.Parser (line 477, column 35 - line 505, column 20): " + [v.value0.value1.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Parser (line 427, column 15 - line 505, column 20): " + [v.value0.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Parser (line 425, column 19 - line 505, column 20): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($tco_var_acc, $tco_var_errs, $copy_i);
        }
        ;
        return $tco_result;
      };
    };
  };
  var buildBlock = function(acc) {
    return function(errs) {
      return function(gateErr) {
        return function(span2) {
          return function(sigil) {
            return function(interior) {
              return function(i) {
                var hr = headedRecovering2(parseMaxHead)(span2)(interior);
                var errs1 = append6(errs)(catMaybes([gateErr, hr.error]));
                if (hr.name instanceof Nothing) {
                  return go(new Cons(new NodeError(span2, maybe("parse error")(parseErrorMessage)(hr.error)), acc))(errs1)(i);
                }
                ;
                if (hr.name instanceof Just) {
                  var inner = parseSeq2(toks)(i);
                  var node2 = new Block(span2, sigil, hr.name.value0, hr.args, inner.nodes);
                  var errs2 = append6(errs1)(inner.errors);
                  if (inner.stop instanceof StopEOF2) {
                    return go(new Cons(node2, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, "<eof>", span2.start)))(length(toks));
                  }
                  ;
                  if (inner.stop instanceof StopClose2) {
                    if (inner.stop.value0 === hr.name.value0) {
                      return go(new Cons(node2, acc))(errs2)(inner.stop.value1);
                    }
                    ;
                    if (otherwise) {
                      return go(new Cons(node2, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, inner.stop.value0, span2.start)))(inner.stop.value1);
                    }
                    ;
                  }
                  ;
                  throw new Error("Failed pattern match at MaxBars.Parser (line 535, column 13 - line 545, column 24): " + [inner.stop.constructor.name]);
                }
                ;
                throw new Error("Failed pattern match at MaxBars.Parser (line 526, column 7 - line 545, column 24): " + [hr.name.constructor.name]);
              };
            };
          };
        };
      };
    };
  };
  return go(Nil.value)([]);
};
var effectiveTrim2 = function(directives) {
  var v = find2(function(d) {
    return d.key === "trim";
  })(directives);
  if (v instanceof Nothing) {
    return new Right(true);
  }
  ;
  if (v instanceof Just) {
    if (v.value0.value === "standalone") {
      return new Right(true);
    }
    ;
    if (v.value0.value === "none") {
      return new Right(false);
    }
    ;
    return new Left(new BadDirective("invalid @trim value '" + (v.value0.value + "'; expected 'standalone' or 'none'"), v.value0.span.start));
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Parser (line 137, column 28 - line 145, column 8): " + [v.constructor.name]);
};
var collectDirectives2 = function(toks) {
  var go = function($copy_i) {
    return function($copy_headerOpen) {
      return function($copy_acc) {
        var $tco_var_i = $copy_i;
        var $tco_var_headerOpen = $copy_headerOpen;
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i, headerOpen, acc) {
          var v = index(toks)(i);
          if (v instanceof Nothing) {
            $tco_done = true;
            return new Right(acc);
          }
          ;
          if (v instanceof Just && v.value0 instanceof RComment2) {
            var dirs = parseDirectives2(v.value0.value1)(v.value0.value2);
            if (headerOpen) {
              $tco_var_i = i + 1 | 0;
              $tco_var_headerOpen = true;
              $copy_acc = append6(acc)(dirs);
              return;
            }
            ;
            var v1 = head(dirs);
            if (v1 instanceof Just) {
              $tco_done = true;
              return new Left(new DirectiveAfterHeader(v1.value0.span.start));
            }
            ;
            if (v1 instanceof Nothing) {
              $tco_var_i = i + 1 | 0;
              $tco_var_headerOpen = false;
              $copy_acc = acc;
              return;
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Parser (line 168, column 14 - line 170, column 42): " + [v1.constructor.name]);
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent2) {
            $tco_var_i = i + 1 | 0;
            $tco_var_headerOpen = headerOpen;
            $copy_acc = acc;
            return;
          }
          ;
          if (v instanceof Just) {
            $tco_var_i = i + 1 | 0;
            $tco_var_headerOpen = false;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at MaxBars.Parser (line 161, column 25 - line 172, column 35): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($tco_var_i, $tco_var_headerOpen, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
  };
  return go(0)(true)([]);
};
var parseRecovering2 = function(src) {
  var runSeq = function($copy_toks) {
    return function($copy_idx) {
      return function($copy_accNodes) {
        return function($copy_accErrs) {
          var $tco_var_toks = $copy_toks;
          var $tco_var_idx = $copy_idx;
          var $tco_var_accNodes = $copy_accNodes;
          var $tco_done = false;
          var $tco_result;
          function $tco_loop(toks, idx, accNodes, accErrs) {
            var r = parseSeq2(toks)(idx);
            var nodes$prime = append6(accNodes)(r.nodes);
            var errs$prime = append6(accErrs)(r.errors);
            if (r.stop instanceof StopEOF2) {
              $tco_done = true;
              return {
                nodes: nodes$prime,
                errors: errs$prime
              };
            }
            ;
            if (r.stop instanceof StopClose2) {
              $tco_var_toks = toks;
              $tco_var_idx = r.stop.value1;
              $tco_var_accNodes = nodes$prime;
              $copy_accErrs = snoc(errs$prime)(new MismatchedBlock("<none>", r.stop.value0, 0));
              return;
            }
            ;
            throw new Error("Failed pattern match at MaxBars.Parser (line 121, column 7 - line 124, column 63): " + [r.stop.constructor.name]);
          }
          ;
          while (!$tco_done) {
            $tco_result = $tco_loop($tco_var_toks, $tco_var_idx, $tco_var_accNodes, $copy_accErrs);
          }
          ;
          return $tco_result;
        };
      };
    };
  };
  var v = tokenize(src);
  if (v instanceof Left) {
    return {
      directives: [],
      nodes: [],
      errors: [v.value0]
    };
  }
  ;
  if (v instanceof Right) {
    var dirRes = collectDirectives2(v.value0);
    var directives = either($$const([]))(identity11)(dirRes);
    var trimRes = effectiveTrim2(directives);
    var standalone = either($$const(false))(identity11)(trimRes);
    var toks$prime = (function() {
      if (standalone) {
        return trimStandalone2(maxClauseSeps)(v.value0);
      }
      ;
      return v.value0;
    })();
    var filtered = filter(function($220) {
      return !isComment2($220);
    })(toks$prime);
    var seq = runSeq(filtered)(0)([])([]);
    var trimErrs = either(singleton2)($$const([]))(trimRes);
    var dirErrs = either(singleton2)($$const([]))(dirRes);
    return {
      directives,
      nodes: seq.nodes,
      errors: append6(dirErrs)(append6(trimErrs)(seq.errors))
    };
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Parser (line 86, column 23 - line 105, column 82): " + [v.constructor.name]);
};
var parse2 = function(src) {
  var r = parseRecovering2(src);
  var v = fromArray(r.errors);
  if (v instanceof Just) {
    return new Left(v.value0);
  }
  ;
  if (v instanceof Nothing) {
    return new Right({
      directives: r.directives,
      nodes: r.nodes
    });
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Parser (line 74, column 5 - line 76, column 68): " + [v.constructor.name]);
};

// output/MaxBars/index.js
var bind14 = /* @__PURE__ */ bind(bindEither);
var lmap4 = /* @__PURE__ */ lmap(bifunctorEither);
var pure13 = /* @__PURE__ */ pure(applicativeEither);
var show16 = /* @__PURE__ */ show(showParseError);
var maxSurfaceParse = {
  parse: parse2,
  statementTags: true,
  partialBlocks: false
};
var maxLoopVars = /* @__PURE__ */ reservedScope(noLoopVars);
var renderMax = /* @__PURE__ */ renderSurfaceDiagWith(false)(maxLoopVars)(maxSurfaceParse)(nonEmpty);
var renderMaxMappedWith = /* @__PURE__ */ renderSurfaceMappedDiagWith(false)(maxLoopVars)(maxSurfaceParse)(nonEmpty);
var renderMaxMapped = /* @__PURE__ */ renderMaxMappedWith([]);
var renderWithOperations = /* @__PURE__ */ renderSurfaceWithHelpersWith(false)(maxLoopVars)(maxSurfaceParse)(nonEmpty);
var renderMaxWithPartials = /* @__PURE__ */ renderWithOperations([]);
var inspectMaxWith = /* @__PURE__ */ inspectSurfaceDiagWith(false)(maxLoopVars)(maxSurfaceParse)(nonEmpty);
var inferMaxData = function(samples) {
  return function(src) {
    return bind14(lmap4(function($9) {
      return show16(head2($9));
    })(parse2(src)))(function(parsed) {
      return bind14(lmap4(show16)(resolveInheritance(parsed.nodes)))(function(inherited) {
        return pure13(inferTemplateData(samples)(desugarSurfaceWith(maxLoopVars)(renameSurfaceHeads(inherited))));
      });
    });
  };
};
var inferMax = function(src) {
  return bind14(lmap4(function($10) {
    return show16(head2($10));
  })(parse2(src)))(function(parsed) {
    return bind14(lmap4(show16)(resolveInheritance(parsed.nodes)))(function(inherited) {
      return pure13(inferTemplate(desugarSurfaceWith(maxLoopVars)(renameSurfaceHeads(inherited))));
    });
  });
};
var compileMaxJsWith = function(partials) {
  return compileSurfaceWithPartials(false)(maxLoopVars)(maxSurfaceParse)("rt.truthyNonEmpty")(partials);
};
var compileMaxJs = /* @__PURE__ */ compileSurfaceWith(false)(maxLoopVars)(maxSurfaceParse)("rt.truthyNonEmpty");

// output/MaxBars.Highlight/index.js
var eq18 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var append7 = /* @__PURE__ */ append(semigroupArray);
var elem19 = /* @__PURE__ */ elem2(eqString);
var maxClauseSeps2 = ["else", "elif", "when"];
var isSpace6 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var trimmedChars2 = /* @__PURE__ */ (function() {
  var $55 = dropWhile(isSpace6);
  return function($56) {
    return $55(toCharArray($56));
  };
})();
var isPartialHead2 = function(s) {
  return eq18(head(trimmedChars2(s)))(new Just(">"));
};
var headWord2 = function(s) {
  return fromCharArray(takeWhile(function($57) {
    return !isSpace6($57);
  })(trimmedChars2(s)));
};
var tokenizeSpans2 = function(src) {
  var tag = function(sp) {
    return function(kind) {
      return [{
        from: sp.start,
        to: sp.end,
        kind,
        role: "tag"
      }];
    };
  };
  var carve = function(pt) {
    return function(kind) {
      return {
        from: pt.at,
        to: pt.end,
        kind,
        role: "interior"
      };
    };
  };
  var interiorSpan = function(pt) {
    if (pt.tok instanceof TStr) {
      return new Just(carve(pt)("string"));
    }
    ;
    if (pt.tok instanceof TNum) {
      return new Just(carve(pt)("number"));
    }
    ;
    if (pt.tok instanceof TOp) {
      return new Just(carve(pt)("operator"));
    }
    ;
    return Nothing.value;
  };
  var carveInterior = function(v2) {
    if (v2 instanceof Left) {
      return [];
    }
    ;
    if (v2 instanceof Right) {
      return mapMaybe(interiorSpan)(v2.value0);
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Highlight (line 93, column 19 - line 95, column 51): " + [v2.constructor.name]);
  };
  var openSpans = function(sp) {
    return function(sig) {
      return function($$int2) {
        if (sig instanceof Section) {
          return append7(tag(sp)("block-open"))(carveInterior($$int2));
        }
        ;
        if (sig instanceof PartialBlock) {
          return append7(tag(sp)("block-open"))(carveInterior($$int2));
        }
        ;
        if (sig instanceof Decorator) {
          return append7(tag(sp)("block-open"))(carveInterior($$int2));
        }
        ;
        if (sig instanceof Inverse) {
          return tag(sp)("error");
        }
        ;
        if (sig instanceof Parent) {
          return tag(sp)("error");
        }
        ;
        if (sig instanceof BlockDef) {
          return tag(sp)("error");
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Highlight (line 82, column 26 - line 88, column 31): " + [sig.constructor.name]);
      };
    };
  };
  var spansOf = function(v2) {
    if (v2 instanceof RContent2) {
      return [];
    }
    ;
    if (v2 instanceof RAmp2) {
      return tag(v2.value0)("error");
    }
    ;
    if (v2 instanceof ROpen2) {
      return openSpans(v2.value0)(v2.value1)(v2.value4);
    }
    ;
    if (v2 instanceof RClose2) {
      return append7(tag(v2.value0)("block-close"))(carveInterior(v2.value3));
    }
    ;
    if (v2 instanceof RSep3) {
      if (isPartialHead2(v2.value2)) {
        return tag(v2.value0)("partial");
      }
      ;
      if (elem19(headWord2(v2.value2))(maxClauseSeps2)) {
        return append7(tag(v2.value0)("keyword"))(carveInterior(v2.value3));
      }
      ;
      if (headWord2(v2.value2) === "set") {
        return append7(tag(v2.value0)("keyword"))(carveInterior(v2.value3));
      }
      ;
      if (otherwise) {
        return append7(tag(v2.value0)("expr"))(carveInterior(v2.value3));
      }
      ;
    }
    ;
    if (v2 instanceof RRaw3) {
      if (v2.value1) {
        return tag(v2.value0)("raw-block");
      }
      ;
      if (otherwise) {
        return tag(v2.value0)("error");
      }
      ;
    }
    ;
    if (v2 instanceof RComment2) {
      return tag(v2.value0)("comment");
    }
    ;
    if (v2 instanceof RError2) {
      return tag(v2.value0)("unterminated");
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Highlight (line 51, column 13 - line 75, column 41): " + [v2.constructor.name]);
  };
  var v = tokenize(src);
  if (v instanceof Left) {
    return [];
  }
  ;
  if (v instanceof Right) {
    return concatMap(spansOf)(v.value0);
  }
  ;
  throw new Error("Failed pattern match at MaxBars.Highlight (line 46, column 21 - line 48, column 45): " + [v.constructor.name]);
};
var highlightSpans2 = function(src) {
  var tagOnly = function(s) {
    if (s.role === "tag") {
      return new Just({
        from: s.from,
        to: s.to,
        kind: s.kind
      });
    }
    ;
    if (otherwise) {
      return Nothing.value;
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Highlight (line 115, column 3 - line 115, column 34): " + [s.constructor.name]);
  };
  return mapMaybe(tagOnly)(tokenizeSpans2(src));
};

// output/MinBars.Compile/index.js
var show17 = /* @__PURE__ */ show(showNumber);
var mBlock = function(rec) {
  return function(ctx2) {
    return function(name2) {
      return function(args) {
        return function(body) {
          var child = rec.child(ctx2);
          var arg0 = (function() {
            var v = head(args);
            if (v instanceof Just) {
              return rec.expr(ctx2)(v.value0);
            }
            ;
            if (v instanceof Nothing) {
              return "null";
            }
            ;
            throw new Error("Failed pattern match at MinBars.Compile (line 70, column 10 - line 72, column 22): " + [v.constructor.name]);
          })();
          if (name2 === "section") {
            return "  out += rt.msection(" + (arg0 + (", " + (ctx2.scope + (", function (" + (child.scope + (') { let out = "";\n' + (rec.nodes(child)(body) + "  return out; });\n")))))));
          }
          ;
          if (name2 === "inverted") {
            return "  if (rt.mfalsy(" + (ctx2.scope + (", " + (arg0 + (")) {\n" + (rec.nodes(ctx2)(body) + "  }\n")))));
          }
          ;
          if (name2 === "@reindent") {
            return "  out += rt.mindentOverride(" + (arg0 + (', (function () { let out = "";\n' + (rec.nodes(ctx2)(body) + "  return out; })());\n")));
          }
          ;
          return `  throw new Error("MinBars compile: unsupported block '` + (name2 + `'");
`);
        };
      };
    };
  };
};
var litJs2 = function(v) {
  if (v instanceof VString) {
    return jsString(v.value0);
  }
  ;
  if (v instanceof VBool) {
    if (v.value0) {
      return "true";
    }
    ;
    return "false";
  }
  ;
  if (v instanceof VNull) {
    return "null";
  }
  ;
  if (v instanceof VNumber) {
    return show17(v.value0);
  }
  ;
  return "null";
};
var mExpr = function(rec) {
  return function(ctx2) {
    return function(v) {
      if (v instanceof App2 && (v.value0 === "mlookup" && (v.value1.length === 1 && (v["value1"][0] instanceof Lit && v["value1"][0].value0 instanceof VString)))) {
        return "rt.mlookup(" + (ctx2.scope + (", " + (jsString(v["value1"][0].value0.value0) + ")")));
      }
      ;
      if (v instanceof App2 && (v.value0 === "escape" && v.value1.length === 1)) {
        return "rt.esc(" + (rec.expr(ctx2)(v["value1"][0]) + ")");
      }
      ;
      if (v instanceof Lit) {
        return litJs2(v.value0);
      }
      ;
      return '(function () { throw new Error("MinBars compile: unsupported expression"); })()';
    };
  };
};
var minEmit = {
  expr: mExpr,
  block: mBlock
};

// output/MinBars.Context/index.js
var lookup12 = /* @__PURE__ */ lookup2(ordString);
var foldl7 = /* @__PURE__ */ foldl(foldableList);
var walk2 = function($copy_key) {
  return function($copy_v) {
    var $tco_var_key = $copy_key;
    var $tco_done = false;
    var $tco_result;
    function $tco_loop(key, v) {
      if (v instanceof Nil) {
        $tco_done = true;
        return VNull.value;
      }
      ;
      if (v instanceof Cons) {
        if (v.value0 instanceof VObject) {
          var v2 = lookup12(key)(v.value0.value0);
          if (v2 instanceof Just) {
            $tco_done = true;
            return v2.value0;
          }
          ;
          if (v2 instanceof Nothing) {
            $tco_var_key = key;
            $copy_v = v.value1;
            return;
          }
          ;
          throw new Error("Failed pattern match at MinBars.Context (line 142, column 18 - line 144, column 31): " + [v2.constructor.name]);
        }
        ;
        $tco_var_key = key;
        $copy_v = v.value1;
        return;
      }
      ;
      throw new Error("Failed pattern match at MinBars.Context (line 139, column 12 - line 145, column 23): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_key, $copy_v);
    }
    ;
    return $tco_result;
  };
};
var seedEnv = function(truthy) {
  return function(dat) {
    return function(partials) {
      return {
        stack: new Cons(dat, Nil.value),
        partials,
        depth: 0,
        truthy,
        blocks: Nil.value
      };
    };
  };
};
var push3 = function(v) {
  return function(v1) {
    return {
      partials: v1.partials,
      depth: v1.depth,
      truthy: v1.truthy,
      blocks: v1.blocks,
      stack: new Cons(v, v1.stack)
    };
  };
};
var minTruthy = function(v) {
  return v.truthy;
};
var minStack = function(v) {
  return v.stack;
};
var minPartials = function(v) {
  return v.partials;
};
var minDepth = function(v) {
  return v.depth;
};
var minBlocks = function(v) {
  return v.blocks;
};
var layerBlocks = function(m) {
  return function(v) {
    return {
      stack: v.stack,
      partials: v.partials,
      depth: v.depth,
      truthy: v.truthy,
      blocks: new Cons(m, v.blocks)
    };
  };
};
var enterPartial2 = function(v) {
  return {
    stack: v.stack,
    partials: v.partials,
    truthy: v.truthy,
    blocks: v.blocks,
    depth: v.depth + 1 | 0
  };
};
var descend = function(acc) {
  return function(seg) {
    if (acc instanceof VObject) {
      return fromMaybe(VNull.value)(lookup12(seg)(acc.value0));
    }
    ;
    return VNull.value;
  };
};
var mresolve = function(name2) {
  return function(v) {
    if (name2 === ".") {
      return fromMaybe(VNull.value)(head3(v.stack));
    }
    ;
    if (otherwise) {
      var v1 = uncons(split(".")(name2));
      if (v1 instanceof Nothing) {
        return VNull.value;
      }
      ;
      if (v1 instanceof Just) {
        var base = walk2(v1.value0.head)(v.stack);
        return foldl2(descend)(base)(v1.value0.tail);
      }
      ;
      throw new Error("Failed pattern match at MinBars.Context (line 129, column 17 - line 135, column 40): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Context (line 126, column 1 - line 126, column 38): " + [name2.constructor.name, v.constructor.name]);
  };
};
var blookup = function(name2) {
  var pick = function(acc) {
    return function(layer) {
      var v = lookup12(name2)(layer);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        return acc;
      }
      ;
      throw new Error("Failed pattern match at MinBars.Context (line 100, column 20 - line 102, column 19): " + [v.constructor.name]);
    };
  };
  return foldl7(pick)(Nothing.value);
};

// output/MinBars.Prelude/index.js
var traverse9 = /* @__PURE__ */ traverse(traversableArray);
var eq36 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqString));
var append19 = /* @__PURE__ */ append(semigroupArray);
var lookup13 = /* @__PURE__ */ lookup2(ordString);
var stringifyOrEmpty = function(dictMonadThrow) {
  var $203 = liftEither(dictMonadThrow);
  return function($204) {
    return $203(stringify($204));
  };
};
var sectionH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var traverse16 = traverse9(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        var items = (function() {
          if (args[0] instanceof VArray) {
            return args[0].value0;
          }
          ;
          var $120 = minTruthy(ctl.env)(args[0]);
          if ($120) {
            return [args[0]];
          }
          ;
          return [];
        })();
        return map37((function() {
          var $205 = joinWith("");
          return function($206) {
            return VSafe.create($205($206));
          };
        })())(traverse16(function(it) {
          return ctl.render(push3(it)(ctl.env))(ctl.children);
        })(items));
      }
      ;
      return throwError3(new HelperError("section: expected exactly one argument"));
    };
  };
};
var mlookupH = function(dictMonadThrow) {
  var pure19 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1 && args[0] instanceof VString) {
        return pure19(mresolve(args[0].value0)(ctl.env));
      }
      ;
      return throwError3(new HelperError("mlookup: expected exactly one string name"));
    };
  };
};
var leadingIndent = function(s) {
  var isHWs2 = function(c) {
    return c === " " || c === "	";
  };
  return fromCharArray(takeWhile(isHWs2)(toCharArray(s)));
};
var invertedH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var pure19 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        var $126 = !minTruthy(ctl.env)(args[0]);
        if ($126) {
          return map37(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        return pure19(new VSafe(""));
      }
      ;
      return throwError3(new HelperError("inverted: expected exactly one argument"));
    };
  };
};
var indentTemplate = function(indent) {
  return function(tmpl) {
    if (indent === "") {
      return tmpl;
    }
    ;
    if (otherwise) {
      var lastI = length(tmpl) - 1 | 0;
      var indentContent = function(atLineStart) {
        return function(isLast) {
          return function(s) {
            var parts = split("\n")(s);
            var nParts = length(parts);
            var lastP = nParts - 1 | 0;
            var piece = function(j) {
              return function(p) {
                var lead = (function() {
                  var $130 = j === 0 && atLineStart || j > 0;
                  if ($130) {
                    return indent;
                  }
                  ;
                  return "";
                })();
                var dropLead = j === lastP && (p === "" && j > 0);
                if (dropLead) {
                  return "";
                }
                ;
                return lead + p;
              };
            };
            var text = joinWith("\n")(mapWithIndex2(piece)(parts));
            var endsNL = lastP >= 0 && eq36(index(parts)(lastP))(new Just(""));
            return {
              text,
              nextAtLineStart: endsNL && !isLast
            };
          };
        };
      };
      var go = function(atLineStart) {
        return function(i) {
          return function(nodes) {
            var v = uncons(nodes);
            if (v instanceof Nothing) {
              return [];
            }
            ;
            if (v instanceof Just) {
              var isLast = i === lastI;
              if (v.value0.head instanceof Content) {
                var v1 = indentContent(atLineStart)(isLast)(v.value0.head.value1);
                return cons(new Content(v.value0.head.value0, v1.text))(go(v1.nextAtLineStart)(i + 1 | 0)(v.value0.tail));
              }
              ;
              var pre = (function() {
                if (atLineStart) {
                  return [new Content({
                    start: 0,
                    end: 0
                  }, indent)];
                }
                ;
                return [];
              })();
              return append19(pre)(cons(v.value0.head)(go(false)(i + 1 | 0)(v.value0.tail)));
            }
            ;
            throw new Error("Failed pattern match at MinBars.Prelude (line 303, column 32 - line 326, column 66): " + [v.constructor.name]);
          };
        };
      };
      return go(true)(0)(tmpl);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Prelude (line 297, column 1 - line 297, column 49): " + [indent.constructor.name, tmpl.constructor.name]);
  };
};
var partialH2 = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var pure19 = pure(Monad0.Applicative0());
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = lookup13(args[0].value0)(minPartials(ctl.env));
        if (v instanceof Just) {
          if (minDepth(ctl.env) >= recursionBudget) {
            return throwError3(new RecursionLimit(recursionBudget));
          }
          ;
          if (otherwise) {
            return map37(VSafe.create)(ctl.render(enterPartial2(ctl.env))(indentTemplate(args[1].value0)(v.value0)));
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure19(new VSafe(""));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 139, column 39 - line 143, column 31): " + [v.constructor.name]);
      }
      ;
      return pure19(new VSafe(""));
    };
  };
};
var escapeH = function(dictMonadThrow) {
  var map37 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyOrEmpty1 = stringifyOrEmpty(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      if (args.length === 1) {
        return map37(function($207) {
          return VSafe.create(escapeHtml($207));
        })(stringifyOrEmpty1(args[0]));
      }
      ;
      return throwError3(new HelperError("escape: expected exactly one argument"));
    };
  };
};
var ensureTrailingNL = function(s) {
  var $152 = takeRight(1)(s) === "\n";
  if ($152) {
    return s;
  }
  ;
  return s + "\n";
};
var indentOverride = function(indent) {
  return function(body) {
    if (body === "") {
      return body;
    }
    ;
    if (otherwise) {
      var ls = split("\n")(body);
      var lastI = length(ls) - 1 | 0;
      var prefix = function(i) {
        return function(l) {
          var $155 = i === lastI && l === "" || l === "";
          if ($155) {
            return l;
          }
          ;
          return indent + l;
        };
      };
      return ensureTrailingNL(joinWith("\n")(mapWithIndex2(prefix)(ls)));
    }
    ;
    throw new Error("Failed pattern match at MinBars.Prelude (line 277, column 1 - line 277, column 45): " + [indent.constructor.name, body.constructor.name]);
  };
};
var dedentTemplate = /* @__PURE__ */ (function() {
  var dropContent = function(atLineStart) {
    return function(amount) {
      return function(s) {
        var strip = function(p) {
          return fromMaybe(p)(stripPrefix(amount)(p));
        };
        var piece = function(i) {
          return function(p) {
            var $156 = i === 0 && !atLineStart;
            if ($156) {
              return p;
            }
            ;
            return strip(p);
          };
        };
        var parts = split("\n")(s);
        var text = joinWith("\n")(mapWithIndex2(piece)(parts));
        var endsNL = takeRight(1)(s) === "\n";
        return {
          text,
          nextAtLineStart: endsNL
        };
      };
    };
  };
  var go = function(atLineStart) {
    return function(amount) {
      return function(nodes) {
        var v = uncons(nodes);
        if (v instanceof Nothing) {
          return [];
        }
        ;
        if (v instanceof Just) {
          if (v.value0.head instanceof Content) {
            var v1 = dropContent(atLineStart)(amount)(v.value0.head.value1);
            return cons(new Content(v.value0.head.value0, v1.text))(go(v1.nextAtLineStart)(amount)(v.value0.tail));
          }
          ;
          return cons(v.value0.head)(go(false)(amount)(v.value0.tail));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 207, column 33 - line 215, column 55): " + [v.constructor.name]);
      };
    };
  };
  return function(tmpl) {
    var amount = (function() {
      var v = head(tmpl);
      if (v instanceof Just && v.value0 instanceof Content) {
        return leadingIndent(v.value0.value1);
      }
      ;
      return "";
    })();
    var $171 = amount === "";
    if ($171) {
      return tmpl;
    }
    ;
    return go(true)(amount)(tmpl);
  };
})();
var harvestBlocks = /* @__PURE__ */ (function() {
  var blockChild = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
      var v1 = head(v.value3);
      if (v1 instanceof Just && (v1.value0 instanceof Lit && v1.value0.value0 instanceof VString)) {
        var standalone = length(v.value3) >= 2;
        return new Just(new Tuple(v1.value0.value0.value0, (function() {
          if (standalone) {
            return dedentTemplate(v.value4);
          }
          ;
          return v.value4;
        })()));
      }
      ;
      return Nothing.value;
    }
    ;
    return Nothing.value;
  };
  var $208 = fromFoldable2(ordString)(foldableArray);
  var $209 = mapMaybe(blockChild);
  return function($210) {
    return $208($209($210));
  };
})();
var parentH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var map37 = map(Monad0.Bind1().Apply0().Functor0());
  var pure19 = pure(Monad0.Applicative0());
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = lookup13(args[0].value0)(minPartials(ctl.env));
        if (v instanceof Just) {
          if (minDepth(ctl.env) >= recursionBudget) {
            return throwError3(new RecursionLimit(recursionBudget));
          }
          ;
          if (otherwise) {
            var overrides = harvestBlocks(ctl.children);
            var env$prime = layerBlocks(overrides)(enterPartial2(ctl.env));
            return map37(VSafe.create)(ctl.render(env$prime)(indentTemplate(args[1].value0)(v.value0)));
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure19(new VSafe(""));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 157, column 39 - line 168, column 31): " + [v.constructor.name]);
      }
      ;
      return pure19(new VSafe(""));
    };
  };
};
var blockH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind20 = bind(Bind1);
  var pure19 = pure(Monad0.Applicative0());
  var map37 = map(Bind1.Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = blookup(args[0].value0)(minBlocks(ctl.env));
        if (v instanceof Just) {
          return bind20((function() {
            var $192 = args[1].value0 !== "";
            if ($192) {
              return pure19(args[1].value0);
            }
            ;
            return map37(leadingIndent)(ctl.render(ctl.env)(ctl.children));
          })())(function(expand) {
            return bind20(ctl.render(ctl.env)(v.value0))(function(out) {
              return pure19(new VSafe(indentOverride(expand)(out)));
            });
          });
        }
        ;
        if (v instanceof Nothing) {
          return map37(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 244, column 39 - line 255, column 57): " + [v.constructor.name]);
      }
      ;
      if (args.length === 1 && args[0] instanceof VString) {
        var v = blookup(args[0].value0)(minBlocks(ctl.env));
        if (v instanceof Just) {
          return map37(VSafe.create)(ctl.render(ctl.env)(v.value0));
        }
        ;
        if (v instanceof Nothing) {
          return map37(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 258, column 23 - line 260, column 57): " + [v.constructor.name]);
      }
      ;
      return throwError3(new HelperError("block: expected exactly one string name"));
    };
  };
};
var minResolve = function(dictMonadThrow) {
  var pure19 = pure(dictMonadThrow.Monad0().Applicative0());
  var mlookupH1 = mlookupH(dictMonadThrow);
  var escapeH1 = escapeH(dictMonadThrow);
  var sectionH1 = sectionH(dictMonadThrow);
  var invertedH1 = invertedH(dictMonadThrow);
  var partialH1 = partialH2(dictMonadThrow);
  var parentH1 = parentH(dictMonadThrow);
  var blockH1 = blockH(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(name2) {
      if (name2 === "mlookup") {
        return pure19(mlookupH1);
      }
      ;
      if (name2 === "escape") {
        return pure19(escapeH1);
      }
      ;
      if (name2 === "section") {
        return pure19(sectionH1);
      }
      ;
      if (name2 === "inverted") {
        return pure19(invertedH1);
      }
      ;
      if (name2 === "partial") {
        return pure19(partialH1);
      }
      ;
      if (name2 === "parent") {
        return pure19(parentH1);
      }
      ;
      if (name2 === "block") {
        return pure19(blockH1);
      }
      ;
      return throwError3(new HelperError("unknown MinBars helper '" + (name2 + "'")));
    };
  };
};
var minEngine = function(dictMonadThrow) {
  var minResolve1 = minResolve(dictMonadThrow);
  var liftEither2 = liftEither(dictMonadThrow);
  var pure19 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(initial) {
    return {
      initial,
      resolve: minResolve1,
      resolveStrict: minResolve1,
      stringify: function(v) {
        return liftEither2(stringify(v));
      },
      blockArgs: function(args) {
        return {
          positional: args,
          hash: Nothing.value,
          params: [],
          label: Nothing.value
        };
      },
      recordText: function(v) {
        return function(v1) {
          return function(v2) {
            return pure19(unit);
          };
        };
      },
      recordEmit: function(v) {
        return function(v1) {
          return function(produce) {
            return produce;
          };
        };
      }
    };
  };
};

// output/MinBars.Standalone/index.js
var notEq8 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var nlIndex3 = function(first) {
  return function(s) {
    var f = (function() {
      if (first) {
        return findIndex;
      }
      ;
      return findLastIndex;
    })();
    return f(function(v) {
      return v === "\n";
    })(toCharArray(s));
  };
};
var isSpaceCU = function(c) {
  return c === " " || (c === "	" || (c === "\r" || c === "\n"));
};
var isPartialInterior = function(s) {
  var dropWs = dropWhile(isSpaceCU);
  var v = head(dropWs(toCharArray(s)));
  if (v instanceof Just && v.value0 === ">") {
    return true;
  }
  ;
  return false;
};
var isHWs = function(c) {
  return c === " " || c === "	";
};
var hasNL3 = function(s) {
  return notEq8(nlIndex3(true)(s))(Nothing.value);
};
var eligible = function(v) {
  if (v instanceof ROpen) {
    return true;
  }
  ;
  if (v instanceof RClose) {
    return true;
  }
  ;
  if (v instanceof RComment) {
    return true;
  }
  ;
  if (v instanceof RSetDelim) {
    return true;
  }
  ;
  if (v instanceof RSep) {
    return isPartialInterior(v.value2);
  }
  ;
  return false;
};
var dropTrailingIndent3 = function(s) {
  var v = nlIndex3(false)(s);
  if (v instanceof Just) {
    return take2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at MinBars.Standalone (line 75, column 24 - line 77, column 16): " + [v.constructor.name]);
};
var dropLeadingLine3 = function(s) {
  var v = nlIndex3(true)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at MinBars.Standalone (line 68, column 21 - line 70, column 16): " + [v.constructor.name]);
};
var beforeFirstNL3 = function(s) {
  var v = nlIndex3(true)(s);
  if (v instanceof Just) {
    return take2(v.value0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at MinBars.Standalone (line 61, column 19 - line 63, column 15): " + [v.constructor.name]);
};
var allWs3 = /* @__PURE__ */ (function() {
  var $88 = all2(isSpaceCU);
  return function($89) {
    return $88(toCharArray($89));
  };
})();
var afterLastNL3 = function(s) {
  var v = nlIndex3(false)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at MinBars.Standalone (line 56, column 17 - line 58, column 15): " + [v.constructor.name]);
};
var mustacheStandalone = function(toks0) {
  var rightBlank = function(i) {
    var v = index(toks0)(i + 1 | 0);
    if (v instanceof Nothing) {
      return true;
    }
    ;
    if (v instanceof Just && v.value0 instanceof RContent) {
      if (hasNL3(v.value0.value1)) {
        return allWs3(beforeFirstNL3(v.value0.value1));
      }
      ;
      if (otherwise) {
        return allWs3(v.value0.value1) && rightBlank(i + 1 | 0);
      }
      ;
    }
    ;
    if (v instanceof Just) {
      return eligible(v.value0) && rightBlank(i + 1 | 0);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Standalone (line 153, column 18 - line 158, column 47): " + [v.constructor.name]);
  };
  var leftBlank = function(i) {
    var v = index(toks0)(i - 1 | 0);
    if (v instanceof Nothing) {
      return true;
    }
    ;
    if (v instanceof Just && v.value0 instanceof RContent) {
      if (hasNL3(v.value0.value1)) {
        return allWs3(afterLastNL3(v.value0.value1));
      }
      ;
      if (otherwise) {
        return allWs3(v.value0.value1) && leftBlank(i - 1 | 0);
      }
      ;
    }
    ;
    if (v instanceof Just) {
      return eligible(v.value0) && leftBlank(i - 1 | 0);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Standalone (line 140, column 17 - line 148, column 46): " + [v.constructor.name]);
  };
  var standaloneAt = function(i) {
    var v = index(toks0)(i);
    if (v instanceof Just && eligible(v.value0)) {
      return leftBlank(i) && rightBlank(i);
    }
    ;
    return false;
  };
  var trimContent = function(j) {
    return function(v) {
      if (v instanceof RContent) {
        var s1 = (function() {
          var $64 = standaloneAt(j - 1 | 0);
          if ($64) {
            return dropLeadingLine3(v.value1);
          }
          ;
          return v.value1;
        })();
        var s2 = (function() {
          var $65 = standaloneAt(j + 1 | 0);
          if ($65) {
            return dropTrailingIndent3(s1);
          }
          ;
          return s1;
        })();
        return new RContent(v.value0, s2);
      }
      ;
      return v;
    };
  };
  var trimmed = mapWithIndex2(trimContent)(toks0);
  var indentAt = function(i) {
    var v = index(toks0)(i - 1 | 0);
    if (v instanceof Nothing) {
      return "";
    }
    ;
    if (v instanceof Just && v.value0 instanceof RContent) {
      return fromCharArray(takeWhile(isHWs)(toCharArray(afterLastNL3(v.value0.value1))));
    }
    ;
    if (v instanceof Just) {
      return "";
    }
    ;
    throw new Error("Failed pattern match at MinBars.Standalone (line 122, column 16 - line 126, column 17): " + [v.constructor.name]);
  };
  var reindent = function(i) {
    return function(base) {
      return function(s) {
        var s$prime = s + (' "' + (indentAt(i) + '"'));
        return {
          s: s$prime,
          "int": tokenizeInterior(base)(s$prime)
        };
      };
    };
  };
  var inject = function(i) {
    return function(v) {
      if (v instanceof RSep && (isPartialInterior(v.value2) && standaloneAt(i))) {
        var r = reindent(i)(v.value1)(v.value2);
        return new RSep(v.value0, v.value1, r.s, r["int"]);
      }
      ;
      if (v instanceof ROpen && (v.value1 instanceof Parent && standaloneAt(i))) {
        var r = reindent(i)(v.value2)(v.value3);
        return new ROpen(v.value0, Parent.value, v.value2, r.s, r["int"]);
      }
      ;
      if (v instanceof ROpen && (v.value1 instanceof BlockDef && standaloneAt(i))) {
        var r = reindent(i)(v.value2)(v.value3);
        return new ROpen(v.value0, BlockDef.value, v.value2, r.s, r["int"]);
      }
      ;
      return v;
    };
  };
  return mapWithIndex2(inject)(trimmed);
};

// output/MinBars.Surface/index.js
var $runtime_lazy8 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var map32 = /* @__PURE__ */ map(functorMaybe);
var Static = /* @__PURE__ */ (function() {
  function Static2(value0) {
    this.value0 = value0;
  }
  ;
  Static2.create = function(value0) {
    return new Static2(value0);
  };
  return Static2;
})();
var Dynamic = /* @__PURE__ */ (function() {
  function Dynamic2(value0) {
    this.value0 = value0;
  }
  ;
  Dynamic2.create = function(value0) {
    return new Dynamic2(value0);
  };
  return Dynamic2;
})();
var partialIndent = function(args) {
  var v = last(args);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return v.value0.value0.value0;
  }
  ;
  return "";
};
var mlookup = function(name2) {
  return new App2("mlookup", [new Lit(new VString(name2))]);
};
var parentName = function(name2) {
  var v = stripPrefix("*")(name2);
  if (v instanceof Just) {
    return mlookup(v.value0);
  }
  ;
  if (v instanceof Nothing) {
    return new Lit(new VString(name2));
  }
  ;
  throw new Error("Failed pattern match at MinBars.Surface (line 160, column 19 - line 162, column 32): " + [v.constructor.name]);
};
var partialExpr2 = function(pn) {
  return function(indent) {
    var nameExpr = (function() {
      if (pn instanceof Static) {
        return new Lit(new VString(pn.value0));
      }
      ;
      if (pn instanceof Dynamic) {
        return mlookup(pn.value0);
      }
      ;
      throw new Error("Failed pattern match at MinBars.Surface (line 178, column 14 - line 180, column 33): " + [pn.constructor.name]);
    })();
    return new App2("partial", [nameExpr, new Lit(new VString(indent))]);
  };
};
var indentArgs = function(args) {
  var v = last(args);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return [new Lit(new VString(v.value0.value0.value0))];
  }
  ;
  return [];
};
var indentArg = function(args) {
  var v = last(args);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return v.value0.value0.value0;
  }
  ;
  return "";
};
var exprName = function(v) {
  if (v instanceof App2) {
    return v.value0;
  }
  ;
  if (v instanceof Lit && v.value0 instanceof VString) {
    return v.value0.value0;
  }
  ;
  if (v instanceof Lit) {
    return ".";
  }
  ;
  throw new Error("Failed pattern match at MinBars.Surface (line 89, column 12 - line 92, column 15): " + [v.constructor.name]);
};
var $$escape = function(e) {
  return new App2("escape", [e]);
};
var argName = function(v) {
  if (v instanceof App2) {
    return v.value0;
  }
  ;
  if (v instanceof Lit && v.value0 instanceof VString) {
    return v.value0.value0;
  }
  ;
  return "";
};
var partialName2 = function(args0) {
  var args = (function() {
    var v2 = last(args0);
    if (v2 instanceof Just && (v2.value0 instanceof Lit && v2.value0.value0 instanceof VString)) {
      return dropEnd(1)(args0);
    }
    ;
    return args0;
  })();
  var v = map32(argName)(head(args));
  if (v instanceof Just) {
    var v1 = stripPrefix("*")(v.value0);
    if (v1 instanceof Just && v1.value0 === "") {
      return new Dynamic(maybe("")(argName)(index(args)(1)));
    }
    ;
    if (v1 instanceof Just) {
      return new Dynamic(v1.value0);
    }
    ;
    if (v1 instanceof Nothing) {
      return new Static(v.value0);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Surface (line 118, column 13 - line 124, column 24): " + [v1.constructor.name]);
  }
  ;
  if (v instanceof Nothing) {
    return new Static("");
  }
  ;
  throw new Error("Failed pattern match at MinBars.Surface (line 117, column 21 - line 125, column 23): " + [v.constructor.name]);
};
var $lazy_desugar = /* @__PURE__ */ $runtime_lazy8("desugar", "MinBars.Surface", function() {
  var node2 = function(v) {
    if (v instanceof Content) {
      return new Content(v.value0, v.value1);
    }
    ;
    if (v instanceof NodeError) {
      return new NodeError(v.value0, v.value1);
    }
    ;
    if (v instanceof Output) {
      return new Output(v.value0, mlookup(exprName(v.value1)));
    }
    ;
    if (v instanceof Sep) {
      if (v.value1 === ">") {
        return new Output(v.value0, partialExpr2(partialName2(v.value2))(partialIndent(v.value2)));
      }
      ;
      return new Output(v.value0, $$escape(mlookup(v.value1)));
    }
    ;
    if (v instanceof Block && v.value1 instanceof Section) {
      return new Block(v.value0, Section.value, "section", [mlookup(v.value2)], $lazy_desugar(61)(v.value4));
    }
    ;
    if (v instanceof Block && v.value1 instanceof Inverse) {
      return new Block(v.value0, Section.value, "inverted", [mlookup(v.value2)], $lazy_desugar(63)(v.value4));
    }
    ;
    if (v instanceof Block && v.value1 instanceof Parent) {
      return new Block(v.value0, Section.value, "parent", [parentName(v.value2), new Lit(new VString(indentArg(v.value3)))], $lazy_desugar(70)(v.value4));
    }
    ;
    if (v instanceof Block && v.value1 instanceof BlockDef) {
      return new Block(v.value0, Section.value, "block", cons(new Lit(new VString(v.value2)))(indentArgs(v.value3)), $lazy_desugar(78)(v.value4));
    }
    ;
    if (v instanceof Block) {
      return new Block(v.value0, v.value1, v.value2, v.value3, $lazy_desugar(82)(v.value4));
    }
    ;
    if (v instanceof RawBlock) {
      return new RawBlock(v.value0, v.value1, v.value2, v.value3);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Surface (line 43, column 10 - line 84, column 59): " + [v.constructor.name]);
  };
  return map(functorArray)(node2);
});
var desugar2 = /* @__PURE__ */ $lazy_desugar(40);

// output/MinBars/index.js
var bind15 = /* @__PURE__ */ bind(bindEither);
var lmap5 = /* @__PURE__ */ lmap(bifunctorEither);
var pure14 = /* @__PURE__ */ pure(applicativeEither);
var runTemplate5 = /* @__PURE__ */ runTemplate(monadEither);
var minEngine2 = /* @__PURE__ */ minEngine(monadThrowEither);
var traverse10 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable17 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var elem20 = /* @__PURE__ */ elem(foldableList)(eqString);
var lookup14 = /* @__PURE__ */ lookup2(ordString);
var union11 = /* @__PURE__ */ union(ordString);
var map33 = /* @__PURE__ */ map(functorEither);
var mapFlipped3 = /* @__PURE__ */ mapFlipped(functorEither);
var minMeta = function(truthyFn) {
  return {
    runtimeVersion,
    preamble: "",
    seed: "rt.mseed(data, " + (truthyFn + ")")
  };
};
var minLexConfig = /* @__PURE__ */ (function() {
  return {
    open: defaultLexConfig.open,
    close: defaultLexConfig.close,
    keepLongComments: defaultLexConfig.keepLongComments,
    mustacheDelims: true
  };
})();
var minOptions = /* @__PURE__ */ (function() {
  return {
    rawBlockHash: defaultParseOptions.rawBlockHash,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    extras: true,
    inheritance: true,
    decorators: false,
    partialBlocks: false,
    rawBlockHbs: false,
    trimStandalone: false,
    lexConfig: minLexConfig
  };
})();
var parseMinWith = function(cfg) {
  return function(src) {
    return bind15(tokenizeTemplate(cfg)(src))(function(toks) {
      return bind15(collectDirectives(toks))(function(directives) {
        return bind15(lmap5(head2)(buildFromTokens(minOptions)(mustacheStandalone(toks))))(function(nodes) {
          return pure14({
            directives,
            nodes
          });
        });
      });
    });
  };
};
var renderCoreWith = function(rule) {
  return function(cfg) {
    return function(partials) {
      return function(src) {
        return function(dat) {
          var v = parseMinWith(cfg)(src);
          if (v instanceof Left) {
            return new Left(renderParseErrorAt(src)(v.value0));
          }
          ;
          if (v instanceof Right) {
            var seeded = seedEnv(rule)(dat)(partials);
            var v1 = runTemplate5(minEngine2(seeded))(desugar2(v.value0.nodes));
            if (v1 instanceof Left) {
              return new Left(formatError(src)(v1.value0));
            }
            ;
            if (v1 instanceof Right) {
              return new Right(v1.value0);
            }
            ;
            throw new Error("Failed pattern match at MinBars (line 174, column 7 - line 176, column 31): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MinBars (line 168, column 44 - line 176, column 31): " + [v.constructor.name]);
        };
      };
    };
  };
};
var parseMin = /* @__PURE__ */ parseMinWith(minLexConfig);
var renderCore = function(rule) {
  return renderCoreWith(rule)(minLexConfig);
};
var renderWithRule = function(rule) {
  return function(partialSrcs) {
    return function(src) {
      return function(dat) {
        var compilePartial = function(v2) {
          var v1 = parseMin(v2.value1);
          if (v1 instanceof Left) {
            return new Left(renderParseErrorAt(v2.value1)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            return new Right(new Tuple(v2.value0, desugar2(v1.value0.nodes)));
          }
          ;
          throw new Error("Failed pattern match at MinBars (line 143, column 35 - line 145, column 58): " + [v1.constructor.name]);
        };
        var v = traverse10(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          return renderCore(rule)(fromFoldable17(v.value0))(src)(dat);
        }
        ;
        throw new Error("Failed pattern match at MinBars (line 139, column 3 - line 141, column 62): " + [v.constructor.name]);
      };
    };
  };
};
var renderMinCompatWith = /* @__PURE__ */ renderWithRule(mustacheJs);
var renderMinCompat = /* @__PURE__ */ renderMinCompatWith([]);
var renderMinWith = /* @__PURE__ */ renderWithRule(mustache);
var renderMin = /* @__PURE__ */ renderMinWith([]);
var renderMinDiag = renderMin;
var expansionIndent = function(indent) {
  return function(body) {
    if (indent !== "") {
      return new Right(indent);
    }
    ;
    if (otherwise) {
      var v = head(body);
      if (v instanceof Just && v.value0 instanceof Content) {
        return new Right(leadingIndent(v.value0.value1));
      }
      ;
      return new Left(new DisallowedShape("intrinsic block indentation with a non-static default (MinBars compile)", 0));
    }
    ;
    throw new Error("Failed pattern match at MinBars (line 326, column 1 - line 326, column 66): " + [indent.constructor.name, body.constructor.name]);
  };
};
var blockIndent = function(args) {
  var v = index(args)(1);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return v.value0.value0.value0;
  }
  ;
  return "";
};
var inline = function(partials) {
  return function(overrides) {
    return function(chain) {
      return function(depth) {
        return function(tmpl) {
          var recurse = inline(partials)(overrides)(chain)(depth);
          var one2 = function(v) {
            if (v instanceof Output && (v.value1 instanceof App2 && (v.value1.value0 === "partial" && (v.value1.value1.length === 2 && (v["value1"]["value1"][0] instanceof Lit && (v["value1"]["value1"][0].value0 instanceof VString && (v["value1"]["value1"][1] instanceof Lit && v["value1"]["value1"][1].value0 instanceof VString))))))) {
              if (elem20(v["value1"]["value1"][0].value0.value0)(chain)) {
                return new Left(new DisallowedShape("recursive partial '" + (v["value1"]["value1"][0].value0.value0 + "' (MinBars compile)"), 0));
              }
              ;
              if (otherwise) {
                var v1 = lookup14(v["value1"]["value1"][0].value0.value0)(partials);
                if (v1 instanceof Nothing) {
                  return new Right([]);
                }
                ;
                if (v1 instanceof Just) {
                  return inline(partials)(overrides)(new Cons(v["value1"]["value1"][0].value0.value0, chain))(depth)(indentTemplate(v["value1"]["value1"][1].value0.value0)(v1.value0));
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 283, column 22 - line 285, column 99): " + [v1.constructor.name]);
              }
              ;
            }
            ;
            if (v instanceof Output && (v.value1 instanceof App2 && v.value1.value0 === "partial")) {
              return new Left(new DisallowedShape("dynamic-name partial {{>* \u2026}} (MinBars compile)", 0));
            }
            ;
            if (v instanceof Block && (v.value1 instanceof Section && (v.value2 === "parent" && (v.value3.length === 2 && (v["value3"][0] instanceof Lit && (v["value3"][0].value0 instanceof VString && (v["value3"][1] instanceof Lit && v["value3"][1].value0 instanceof VString))))))) {
              if (depth >= recursionBudget) {
                return new Left(new DisallowedShape("inheritance recursion exceeded the budget (MinBars compile)", 0));
              }
              ;
              if (otherwise) {
                var v1 = lookup14(v["value3"][0].value0.value0)(partials);
                if (v1 instanceof Nothing) {
                  return new Right([]);
                }
                ;
                if (v1 instanceof Just) {
                  return inline(partials)(union11(overrides)(harvestBlocks(v.value4)))(chain)(depth + 1 | 0)(indentTemplate(v["value3"][1].value0.value0)(v1.value0));
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 292, column 22 - line 296, column 45): " + [v1.constructor.name]);
              }
              ;
            }
            ;
            if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "parent")) {
              return new Left(new DisallowedShape("dynamic-name parent {{<* \u2026}} (MinBars compile)", 0));
            }
            ;
            if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
              var v1 = head(v.value3);
              if (v1 instanceof Just && (v1.value0 instanceof Lit && v1.value0.value0 instanceof VString)) {
                var v2 = lookup14(v1.value0.value0.value0)(overrides);
                if (v2 instanceof Nothing) {
                  return recurse(v.value4);
                }
                ;
                if (v2 instanceof Just) {
                  return bind15(recurse(v2.value0))(function(inlinedOverride) {
                    var $101 = length(v.value3) >= 2;
                    if ($101) {
                      return bind15(expansionIndent(blockIndent(v.value3))(v.value4))(function(expand) {
                        return new Right([new Block(v.value0, Section.value, "@reindent", [new Lit(new VString(expand))], inlinedOverride)]);
                      });
                    }
                    ;
                    return new Right(inlinedOverride);
                  });
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 301, column 36 - line 308, column 37): " + [v2.constructor.name]);
              }
              ;
              return new Left(new DisallowedShape("malformed block override (MinBars compile)", 0));
            }
            ;
            if (v instanceof Block) {
              return map33(function(b) {
                return [new Block(v.value0, v.value1, v.value2, v.value3, b)];
              })(recurse(v.value4));
            }
            ;
            return new Right([v]);
          };
          return map33(concat)(traverse10(one2)(tmpl));
        };
      };
    };
  };
};
var compileWithSeed = function(truthyFn) {
  return function(partialSrcs) {
    return function(src) {
      var parsePartial = function(v) {
        return mapFlipped3(parseMin(v.value1))(function(r) {
          return new Tuple(v.value0, desugar2(r.nodes));
        });
      };
      return bind15(parseMin(src))(function(v) {
        return bind15(map33(fromFoldable17)(traverse10(parsePartial)(partialSrcs)))(function(partials) {
          return bind15(inline(partials)(empty2)(Nil.value)(0)(desugar2(v.nodes)))(function(inlined) {
            return new Right(compile(minMeta(truthyFn))(minEmit)([])(inlined));
          });
        });
      });
    };
  };
};
var compileMinJsCompatWith = /* @__PURE__ */ compileWithSeed("rt.truthyHandlebars");
var compileMinJsCompat = /* @__PURE__ */ compileMinJsCompatWith([]);
var compileMinJsWith = /* @__PURE__ */ compileWithSeed("rt.truthyMustache");
var compileMinJs = /* @__PURE__ */ compileMinJsWith([]);

// output/MinBars.Analyse/index.js
var pure15 = /* @__PURE__ */ pure(/* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither));
var tell5 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var bindWriterT5 = /* @__PURE__ */ bindWriterT(semigroupArray)(bindEither);
var discard8 = /* @__PURE__ */ discard(discardUnit)(bindWriterT5);
var bind16 = /* @__PURE__ */ bind(bindWriterT5);
var minEngine3 = /* @__PURE__ */ minEngine(/* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither));
var mapFlipped4 = /* @__PURE__ */ mapFlipped(functorEither);
var runTemplate6 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
var traverse11 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable18 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var fixForMustache = function(v) {
  if (v instanceof VString && v.value0 === "") {
    return "Mustache is logic-less \u2014 reshape the data: add a boolean flag in the view-model (e.g. `hasText`), or normalize the empty string to absent (`null`).";
  }
  ;
  if (v instanceof VNumber) {
    return "Mustache is logic-less \u2014 reshape the data: add a boolean flag (e.g. `hasCount`) in the view-model, or normalize 0 to absent (`null`).";
  }
  ;
  if (v instanceof VArray) {
    return "an empty array is falsy on every engine \u2014 iterate with `{{#xs}}\u2026{{/xs}}` and pair `{{^xs}}\u2026{{/xs}}` for the empty case.";
  }
  ;
  if (v instanceof VObject) {
    return "only the `presence` rule calls `{}` falsy \u2014 add an explicit boolean flag to the view-model rather than testing the object.";
  }
  ;
  return "reshape the data so the section tests a real boolean (Mustache is logic-less \u2014 there is no inline test).";
};
var minbarsLabels = /* @__PURE__ */ (function() {
  return {
    engineRule: "mustache-spec",
    rule: mustache,
    fix: fixForMustache,
    legend: '_MinBars renders on the language-agnostic `mustache-spec` rule (`0`/`""`/`{}` truthy, as Ruby/Python Mustache). `mustache.js` instead follows the `handlebars` rule (`0`/`""` falsy), so a finding\'s `flips under: handlebars` is exactly where `mustache.js` branches the other way._'
  };
})();
var analysedEngine = function(seeded) {
  var record2 = function(name2) {
    return function(env) {
      return function(span2) {
        return function(v) {
          if (v instanceof VArray) {
            return pure15(unit);
          }
          ;
          var here = minTruthy(env)(v);
          return tell5([{
            kind: "cond",
            span: span2,
            op: name2,
            value: v,
            truthyHere: here,
            diverges: divergence(v)(here)
          }]);
        };
      };
    };
  };
  var observe2 = function(name2) {
    return function(op) {
      return function(ctl) {
        return function(args) {
          return discard8((function() {
            if (args.length === 1) {
              return record2(name2)(ctl.env)(ctl.span)(args[0]);
            }
            ;
            return pure15(unit);
          })())(function() {
            return op(ctl)(args);
          });
        };
      };
    };
  };
  var wrap3 = function(resolve) {
    return function(env) {
      return function(name2) {
        return bind16(resolve(env)(name2))(function(op) {
          return pure15((function() {
            var $42 = name2 === "section" || name2 === "inverted";
            if ($42) {
              return observe2(name2)(op);
            }
            ;
            return op;
          })());
        });
      };
    };
  };
  var base = minEngine3(seeded);
  return {
    initial: base.initial,
    stringify: base.stringify,
    blockArgs: base.blockArgs,
    recordText: base.recordText,
    recordEmit: base.recordEmit,
    resolve: wrap3(base.resolve),
    resolveStrict: wrap3(base.resolveStrict)
  };
};
var runAnalysisMin = function(partials) {
  return function(dat) {
    return function(nodes) {
      return mapFlipped4(runWriterT(runTemplate6(analysedEngine(seedEnv(mustache)(dat)(partials)))(nodes)))(function(v) {
        return {
          output: v.value0,
          decisions: v.value1
        };
      });
    };
  };
};
var analyseMinWith = function(partialSrcs) {
  return function(src) {
    return function(dat) {
      var compilePartial = function(v3) {
        var v12 = parseMin(v3.value1);
        if (v12 instanceof Left) {
          return new Left(renderParseErrorAt(v3.value1)(v12.value0));
        }
        ;
        if (v12 instanceof Right) {
          return new Right(new Tuple(v3.value0, desugar2(v12.value0.nodes)));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Analyse (line 183, column 35 - line 185, column 58): " + [v12.constructor.name]);
      };
      var v = traverse11(compilePartial)(partialSrcs);
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        var v1 = parseMin(src);
        if (v1 instanceof Left) {
          return new Left(renderParseErrorAt(src)(v1.value0));
        }
        ;
        if (v1 instanceof Right) {
          var v2 = runAnalysisMin(fromFoldable18(v.value0))(dat)(desugar2(v1.value0.nodes));
          if (v2 instanceof Left) {
            return new Left(formatError(src)(v2.value0));
          }
          ;
          if (v2 instanceof Right) {
            return new Right({
              output: v2.value0.output,
              report: reportMarkdownWith(minbarsLabels)(anyPath)(src)(v2.value0.decisions),
              jsonata: jsonataScaffold(src)(v2.value0.decisions),
              findings: allFindings(minbarsLabels)(anyPath)(src)(v2.value0.decisions),
              evaluated: evaluatedCount(v2.value0.decisions)
            });
          }
          ;
          throw new Error("Failed pattern match at MinBars.Analyse (line 173, column 24 - line 181, column 10): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MinBars.Analyse (line 171, column 15 - line 181, column 10): " + [v1.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at MinBars.Analyse (line 169, column 38 - line 181, column 10): " + [v.constructor.name]);
    };
  };
};
var analyseMin = /* @__PURE__ */ analyseMinWith([]);

// output/MinBars.Inspect/index.js
var bindWriterT6 = /* @__PURE__ */ bindWriterT(semigroupArray)(bindEither);
var bind17 = /* @__PURE__ */ bind(bindWriterT6);
var discard9 = /* @__PURE__ */ discard(discardUnit)(bindWriterT6);
var applicativeWriterT5 = /* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither);
var when6 = /* @__PURE__ */ when(applicativeWriterT5);
var tell6 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var pure16 = /* @__PURE__ */ pure(applicativeWriterT5);
var traverse13 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var minEngine4 = /* @__PURE__ */ minEngine(/* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither));
var fromFoldable19 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var runTemplate7 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
var snapshot2 = function(env) {
  var stack = minStack(env);
  return {
    "this": fromMaybe(VNull.value)(head3(stack)),
    parent: index2(stack)(1),
    root: last2(stack),
    index: Nothing.value,
    index1: Nothing.value,
    key: Nothing.value,
    first: Nothing.value,
    last: Nothing.value,
    locals: []
  };
};
var inspectEmit2 = function(target) {
  return function(env) {
    return function(span2) {
      return function(produce) {
        return bind17(produce)(function(s) {
          return discard9(when6(span2.start === target.start && (span2.end === target.end && (minDepth(env) === 0 && target.file === "main")))(tell6([snapshot2(env)])))(function() {
            return pure16(s);
          });
        });
      };
    };
  };
};
var runInspect = function(rule) {
  return function(partialSrcs) {
    return function(target) {
      return function(src) {
        return function(dat) {
          var compilePartial = function(v3) {
            var v12 = parseMin(v3.value1);
            if (v12 instanceof Left) {
              return new Left(renderParseErrorAt(v3.value1)(v12.value0));
            }
            ;
            if (v12 instanceof Right) {
              return new Right(new Tuple(v3.value0, desugar2(v12.value0.nodes)));
            }
            ;
            throw new Error("Failed pattern match at MinBars.Inspect (line 89, column 35 - line 91, column 58): " + [v12.constructor.name]);
          };
          var v = traverse13(compilePartial)(partialSrcs);
          if (v instanceof Left) {
            return new Left(v.value0);
          }
          ;
          if (v instanceof Right) {
            var v1 = parseMin(src);
            if (v1 instanceof Left) {
              return new Left(renderParseErrorAt(src)(v1.value0));
            }
            ;
            if (v1 instanceof Right) {
              var engine = (function() {
                var v22 = minEngine4(seedEnv(rule)(dat)(fromFoldable19(v.value0)));
                return {
                  blockArgs: v22.blockArgs,
                  initial: v22.initial,
                  recordText: v22.recordText,
                  resolve: v22.resolve,
                  resolveStrict: v22.resolveStrict,
                  stringify: v22.stringify,
                  recordEmit: inspectEmit2(target)
                };
              })();
              var v2 = runWriterT(runTemplate7(engine)(desugar2(v1.value0.nodes)));
              if (v2 instanceof Left) {
                return new Left(formatError(src)(v2.value0));
              }
              ;
              if (v2 instanceof Right) {
                return new Right(v2.value0.value1);
              }
              ;
              throw new Error("Failed pattern match at MinBars.Inspect (line 85, column 9 - line 87, column 47): " + [v2.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at MinBars.Inspect (line 78, column 15 - line 87, column 47): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MinBars.Inspect (line 76, column 46 - line 87, column 47): " + [v.constructor.name]);
        };
      };
    };
  };
};
var inspectMinCompatWith = /* @__PURE__ */ runInspect(mustacheJs);
var inspectMinWith = /* @__PURE__ */ runInspect(mustache);

// output/MinBars.Provenance/index.js
var applicativeWriterT6 = /* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither);
var pure17 = /* @__PURE__ */ pure(applicativeWriterT6);
var tell7 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var bindWriterT7 = /* @__PURE__ */ bindWriterT(semigroupArray)(bindEither);
var bind18 = /* @__PURE__ */ bind(bindWriterT7);
var listen3 = /* @__PURE__ */ listen(/* @__PURE__ */ monadWriterWriterT(monoidArray)(monadEither));
var discard10 = /* @__PURE__ */ discard(discardUnit)(bindWriterT7);
var when7 = /* @__PURE__ */ when(applicativeWriterT6);
var traverse14 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var minEngine5 = /* @__PURE__ */ minEngine(/* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither));
var fromFoldable20 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var runTemplate8 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
var recordTextProv2 = function(env) {
  return function(span2) {
    return function(text) {
      if (text === "") {
        return pure17(unit);
      }
      ;
      if (otherwise) {
        return tell7([{
          isEmit: false,
          file: "main",
          span: (function() {
            var $39 = minDepth(env) === 0;
            if ($39) {
              return new Just(span2);
            }
            ;
            return Nothing.value;
          })(),
          text
        }]);
      }
      ;
      throw new Error("Failed pattern match at MinBars.Provenance (line 105, column 1 - line 105, column 56): " + [env.constructor.name, span2.constructor.name, text.constructor.name]);
    };
  };
};
var recordEmitProv2 = function(env) {
  return function(span2) {
    return function(produce) {
      return bind18(listen3(produce))(function(v) {
        return discard10(when7(v.value0 !== "" && $$null(v.value1))(tell7([{
          isEmit: true,
          file: "main",
          span: (function() {
            var $41 = minDepth(env) === 0;
            if ($41) {
              return new Just(span2);
            }
            ;
            return Nothing.value;
          })(),
          text: v.value0
        }])))(function() {
          return pure17(v.value0);
        });
      });
    };
  };
};
var runMapped = function(rule) {
  return function(partialSrcs) {
    return function(src) {
      return function(dat) {
        var compilePartial = function(v3) {
          var v12 = parseMin(v3.value1);
          if (v12 instanceof Left) {
            return new Left(renderParseErrorAt(v3.value1)(v12.value0));
          }
          ;
          if (v12 instanceof Right) {
            return new Right(new Tuple(v3.value0, desugar2(v12.value0.nodes)));
          }
          ;
          throw new Error("Failed pattern match at MinBars.Provenance (line 98, column 35 - line 100, column 58): " + [v12.constructor.name]);
        };
        var v = traverse14(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          var v1 = parseMin(src);
          if (v1 instanceof Left) {
            return new Left(renderParseErrorAt(src)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            var engine = (function() {
              var v22 = minEngine5(seedEnv(rule)(dat)(fromFoldable20(v.value0)));
              return {
                blockArgs: v22.blockArgs,
                initial: v22.initial,
                resolve: v22.resolve,
                resolveStrict: v22.resolveStrict,
                stringify: v22.stringify,
                recordText: recordTextProv2,
                recordEmit: recordEmitProv2
              };
            })();
            var v2 = runWriterT(runTemplate8(engine)(desugar2(v1.value0.nodes)));
            if (v2 instanceof Left) {
              return new Left(formatError(src)(v2.value0));
            }
            ;
            if (v2 instanceof Right) {
              return new Right({
                output: v2.value0.value0,
                segments: assemble(v2.value0.value0)(v2.value0.value1)
              });
            }
            ;
            throw new Error("Failed pattern match at MinBars.Provenance (line 93, column 9 - line 95, column 88): " + [v2.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MinBars.Provenance (line 86, column 15 - line 95, column 88): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MinBars.Provenance (line 84, column 38 - line 95, column 88): " + [v.constructor.name]);
      };
    };
  };
};
var renderMinMappedCompatWith = /* @__PURE__ */ runMapped(mustacheJs);
var renderMinMappedCompat = /* @__PURE__ */ renderMinMappedCompatWith([]);
var renderMinMappedWith = /* @__PURE__ */ runMapped(mustache);
var renderMinMapped = /* @__PURE__ */ renderMinMappedWith([]);

// output/Effect.Aff/foreign.js
var Aff = (function() {
  var EMPTY = {};
  var PURE = "Pure";
  var THROW = "Throw";
  var CATCH = "Catch";
  var SYNC = "Sync";
  var ASYNC = "Async";
  var BIND = "Bind";
  var BRACKET = "Bracket";
  var FORK = "Fork";
  var SEQ = "Sequential";
  var MAP = "Map";
  var APPLY = "Apply";
  var ALT = "Alt";
  var CONS = "Cons";
  var RESUME = "Resume";
  var RELEASE = "Release";
  var FINALIZER = "Finalizer";
  var FINALIZED = "Finalized";
  var FORKED = "Forked";
  var FIBER = "Fiber";
  var THUNK = "Thunk";
  function Aff2(tag, _1, _2, _3) {
    this.tag = tag;
    this._1 = _1;
    this._2 = _2;
    this._3 = _3;
  }
  function AffCtr(tag) {
    var fn = function(_1, _2, _3) {
      return new Aff2(tag, _1, _2, _3);
    };
    fn.tag = tag;
    return fn;
  }
  function nonCanceler(error2) {
    return new Aff2(PURE, void 0);
  }
  function runEff(eff) {
    try {
      eff();
    } catch (error2) {
      setTimeout(function() {
        throw error2;
      }, 0);
    }
  }
  function runSync(left, right, eff) {
    try {
      return right(eff());
    } catch (error2) {
      return left(error2);
    }
  }
  function runAsync(left, eff, k) {
    try {
      return eff(k)();
    } catch (error2) {
      k(left(error2))();
      return nonCanceler;
    }
  }
  var Scheduler = (function() {
    var limit = 1024;
    var size3 = 0;
    var ix = 0;
    var queue = new Array(limit);
    var draining = false;
    function drain() {
      var thunk;
      draining = true;
      while (size3 !== 0) {
        size3--;
        thunk = queue[ix];
        queue[ix] = void 0;
        ix = (ix + 1) % limit;
        thunk();
      }
      draining = false;
    }
    return {
      isDraining: function() {
        return draining;
      },
      enqueue: function(cb) {
        var i, tmp;
        if (size3 === limit) {
          tmp = draining;
          drain();
          draining = tmp;
        }
        queue[(ix + size3) % limit] = cb;
        size3++;
        if (!draining) {
          drain();
        }
      }
    };
  })();
  function Supervisor(util) {
    var fibers = {};
    var fiberId = 0;
    var count = 0;
    return {
      register: function(fiber) {
        var fid = fiberId++;
        fiber.onComplete({
          rethrow: true,
          handler: function(result2) {
            return function() {
              count--;
              delete fibers[fid];
            };
          }
        })();
        fibers[fid] = fiber;
        count++;
      },
      isEmpty: function() {
        return count === 0;
      },
      killAll: function(killError, cb) {
        return function() {
          if (count === 0) {
            return cb();
          }
          var killCount = 0;
          var kills = {};
          function kill(fid) {
            kills[fid] = fibers[fid].kill(killError, function(result2) {
              return function() {
                delete kills[fid];
                killCount--;
                if (util.isLeft(result2) && util.fromLeft(result2)) {
                  setTimeout(function() {
                    throw util.fromLeft(result2);
                  }, 0);
                }
                if (killCount === 0) {
                  cb();
                }
              };
            })();
          }
          for (var k in fibers) {
            if (fibers.hasOwnProperty(k)) {
              killCount++;
              kill(k);
            }
          }
          fibers = {};
          fiberId = 0;
          count = 0;
          return function(error2) {
            return new Aff2(SYNC, function() {
              for (var k2 in kills) {
                if (kills.hasOwnProperty(k2)) {
                  kills[k2]();
                }
              }
            });
          };
        };
      }
    };
  }
  var SUSPENDED = 0;
  var CONTINUE = 1;
  var STEP_BIND = 2;
  var STEP_RESULT = 3;
  var PENDING = 4;
  var RETURN = 5;
  var COMPLETED = 6;
  function Fiber(util, supervisor, aff) {
    var runTick = 0;
    var status = SUSPENDED;
    var step2 = aff;
    var fail = null;
    var interrupt = null;
    var bhead = null;
    var btail = null;
    var attempts = null;
    var bracketCount = 0;
    var joinId = 0;
    var joins = null;
    var rethrow = true;
    function run3(localRunTick) {
      var tmp, result2, attempt;
      while (true) {
        tmp = null;
        result2 = null;
        attempt = null;
        switch (status) {
          case STEP_BIND:
            status = CONTINUE;
            try {
              step2 = bhead(step2);
              if (btail === null) {
                bhead = null;
              } else {
                bhead = btail._1;
                btail = btail._2;
              }
            } catch (e) {
              status = RETURN;
              fail = util.left(e);
              step2 = null;
            }
            break;
          case STEP_RESULT:
            if (util.isLeft(step2)) {
              status = RETURN;
              fail = step2;
              step2 = null;
            } else if (bhead === null) {
              status = RETURN;
            } else {
              status = STEP_BIND;
              step2 = util.fromRight(step2);
            }
            break;
          case CONTINUE:
            switch (step2.tag) {
              case BIND:
                if (bhead) {
                  btail = new Aff2(CONS, bhead, btail);
                }
                bhead = step2._2;
                status = CONTINUE;
                step2 = step2._1;
                break;
              case PURE:
                if (bhead === null) {
                  status = RETURN;
                  step2 = util.right(step2._1);
                } else {
                  status = STEP_BIND;
                  step2 = step2._1;
                }
                break;
              case SYNC:
                status = STEP_RESULT;
                step2 = runSync(util.left, util.right, step2._1);
                break;
              case ASYNC:
                status = PENDING;
                step2 = runAsync(util.left, step2._1, function(result3) {
                  return function() {
                    if (runTick !== localRunTick) {
                      return;
                    }
                    runTick++;
                    Scheduler.enqueue(function() {
                      if (runTick !== localRunTick + 1) {
                        return;
                      }
                      status = STEP_RESULT;
                      step2 = result3;
                      run3(runTick);
                    });
                  };
                });
                return;
              case THROW:
                status = RETURN;
                fail = util.left(step2._1);
                step2 = null;
                break;
              // Enqueue the Catch so that we can call the error handler later on
              // in case of an exception.
              case CATCH:
                if (bhead === null) {
                  attempts = new Aff2(CONS, step2, attempts, interrupt);
                } else {
                  attempts = new Aff2(CONS, step2, new Aff2(CONS, new Aff2(RESUME, bhead, btail), attempts, interrupt), interrupt);
                }
                bhead = null;
                btail = null;
                status = CONTINUE;
                step2 = step2._1;
                break;
              // Enqueue the Bracket so that we can call the appropriate handlers
              // after resource acquisition.
              case BRACKET:
                bracketCount++;
                if (bhead === null) {
                  attempts = new Aff2(CONS, step2, attempts, interrupt);
                } else {
                  attempts = new Aff2(CONS, step2, new Aff2(CONS, new Aff2(RESUME, bhead, btail), attempts, interrupt), interrupt);
                }
                bhead = null;
                btail = null;
                status = CONTINUE;
                step2 = step2._1;
                break;
              case FORK:
                status = STEP_RESULT;
                tmp = Fiber(util, supervisor, step2._2);
                if (supervisor) {
                  supervisor.register(tmp);
                }
                if (step2._1) {
                  tmp.run();
                }
                step2 = util.right(tmp);
                break;
              case SEQ:
                status = CONTINUE;
                step2 = sequential2(util, supervisor, step2._1);
                break;
            }
            break;
          case RETURN:
            bhead = null;
            btail = null;
            if (attempts === null) {
              status = COMPLETED;
              step2 = interrupt || fail || step2;
            } else {
              tmp = attempts._3;
              attempt = attempts._1;
              attempts = attempts._2;
              switch (attempt.tag) {
                // We cannot recover from an unmasked interrupt. Otherwise we should
                // continue stepping, or run the exception handler if an exception
                // was raised.
                case CATCH:
                  if (interrupt && interrupt !== tmp && bracketCount === 0) {
                    status = RETURN;
                  } else if (fail) {
                    status = CONTINUE;
                    step2 = attempt._2(util.fromLeft(fail));
                    fail = null;
                  }
                  break;
                // We cannot resume from an unmasked interrupt or exception.
                case RESUME:
                  if (interrupt && interrupt !== tmp && bracketCount === 0 || fail) {
                    status = RETURN;
                  } else {
                    bhead = attempt._1;
                    btail = attempt._2;
                    status = STEP_BIND;
                    step2 = util.fromRight(step2);
                  }
                  break;
                // If we have a bracket, we should enqueue the handlers,
                // and continue with the success branch only if the fiber has
                // not been interrupted. If the bracket acquisition failed, we
                // should not run either.
                case BRACKET:
                  bracketCount--;
                  if (fail === null) {
                    result2 = util.fromRight(step2);
                    attempts = new Aff2(CONS, new Aff2(RELEASE, attempt._2, result2), attempts, tmp);
                    if (interrupt === tmp || bracketCount > 0) {
                      status = CONTINUE;
                      step2 = attempt._3(result2);
                    }
                  }
                  break;
                // Enqueue the appropriate handler. We increase the bracket count
                // because it should not be cancelled.
                case RELEASE:
                  attempts = new Aff2(CONS, new Aff2(FINALIZED, step2, fail), attempts, interrupt);
                  status = CONTINUE;
                  if (interrupt && interrupt !== tmp && bracketCount === 0) {
                    step2 = attempt._1.killed(util.fromLeft(interrupt))(attempt._2);
                  } else if (fail) {
                    step2 = attempt._1.failed(util.fromLeft(fail))(attempt._2);
                  } else {
                    step2 = attempt._1.completed(util.fromRight(step2))(attempt._2);
                  }
                  fail = null;
                  bracketCount++;
                  break;
                case FINALIZER:
                  bracketCount++;
                  attempts = new Aff2(CONS, new Aff2(FINALIZED, step2, fail), attempts, interrupt);
                  status = CONTINUE;
                  step2 = attempt._1;
                  break;
                case FINALIZED:
                  bracketCount--;
                  status = RETURN;
                  step2 = attempt._1;
                  fail = attempt._2;
                  break;
              }
            }
            break;
          case COMPLETED:
            for (var k in joins) {
              if (joins.hasOwnProperty(k)) {
                rethrow = rethrow && joins[k].rethrow;
                runEff(joins[k].handler(step2));
              }
            }
            joins = null;
            if (interrupt && fail) {
              setTimeout(function() {
                throw util.fromLeft(fail);
              }, 0);
            } else if (util.isLeft(step2) && rethrow) {
              setTimeout(function() {
                if (rethrow) {
                  throw util.fromLeft(step2);
                }
              }, 0);
            }
            return;
          case SUSPENDED:
            status = CONTINUE;
            break;
          case PENDING:
            return;
        }
      }
    }
    function onComplete(join3) {
      return function() {
        if (status === COMPLETED) {
          rethrow = rethrow && join3.rethrow;
          join3.handler(step2)();
          return function() {
          };
        }
        var jid = joinId++;
        joins = joins || {};
        joins[jid] = join3;
        return function() {
          if (joins !== null) {
            delete joins[jid];
          }
        };
      };
    }
    function kill(error2, cb) {
      return function() {
        if (status === COMPLETED) {
          cb(util.right(void 0))();
          return function() {
          };
        }
        var canceler = onComplete({
          rethrow: false,
          handler: function() {
            return cb(util.right(void 0));
          }
        })();
        switch (status) {
          case SUSPENDED:
            interrupt = util.left(error2);
            status = COMPLETED;
            step2 = interrupt;
            run3(runTick);
            break;
          case PENDING:
            if (interrupt === null) {
              interrupt = util.left(error2);
            }
            if (bracketCount === 0) {
              if (status === PENDING) {
                attempts = new Aff2(CONS, new Aff2(FINALIZER, step2(error2)), attempts, interrupt);
              }
              status = RETURN;
              step2 = null;
              fail = null;
              run3(++runTick);
            }
            break;
          default:
            if (interrupt === null) {
              interrupt = util.left(error2);
            }
            if (bracketCount === 0) {
              status = RETURN;
              step2 = null;
              fail = null;
            }
        }
        return canceler;
      };
    }
    function join2(cb) {
      return function() {
        var canceler = onComplete({
          rethrow: false,
          handler: cb
        })();
        if (status === SUSPENDED) {
          run3(runTick);
        }
        return canceler;
      };
    }
    return {
      kill,
      join: join2,
      onComplete,
      isSuspended: function() {
        return status === SUSPENDED;
      },
      run: function() {
        if (status === SUSPENDED) {
          if (!Scheduler.isDraining()) {
            Scheduler.enqueue(function() {
              run3(runTick);
            });
          } else {
            run3(runTick);
          }
        }
      }
    };
  }
  function runPar(util, supervisor, par, cb) {
    var fiberId = 0;
    var fibers = {};
    var killId = 0;
    var kills = {};
    var early = new Error("[ParAff] Early exit");
    var interrupt = null;
    var root = EMPTY;
    function kill(error2, par2, cb2) {
      var step2 = par2;
      var head4 = null;
      var tail2 = null;
      var count = 0;
      var kills2 = {};
      var tmp, kid;
      loop: while (true) {
        tmp = null;
        switch (step2.tag) {
          case FORKED:
            if (step2._3 === EMPTY) {
              tmp = fibers[step2._1];
              kills2[count++] = tmp.kill(error2, function(result2) {
                return function() {
                  count--;
                  if (count === 0) {
                    cb2(result2)();
                  }
                };
              });
            }
            if (head4 === null) {
              break loop;
            }
            step2 = head4._2;
            if (tail2 === null) {
              head4 = null;
            } else {
              head4 = tail2._1;
              tail2 = tail2._2;
            }
            break;
          case MAP:
            step2 = step2._2;
            break;
          case APPLY:
          case ALT:
            if (head4) {
              tail2 = new Aff2(CONS, head4, tail2);
            }
            head4 = step2;
            step2 = step2._1;
            break;
        }
      }
      if (count === 0) {
        cb2(util.right(void 0))();
      } else {
        kid = 0;
        tmp = count;
        for (; kid < tmp; kid++) {
          kills2[kid] = kills2[kid]();
        }
      }
      return kills2;
    }
    function join2(result2, head4, tail2) {
      var fail, step2, lhs, rhs, tmp, kid;
      if (util.isLeft(result2)) {
        fail = result2;
        step2 = null;
      } else {
        step2 = result2;
        fail = null;
      }
      loop: while (true) {
        lhs = null;
        rhs = null;
        tmp = null;
        kid = null;
        if (interrupt !== null) {
          return;
        }
        if (head4 === null) {
          cb(fail || step2)();
          return;
        }
        if (head4._3 !== EMPTY) {
          return;
        }
        switch (head4.tag) {
          case MAP:
            if (fail === null) {
              head4._3 = util.right(head4._1(util.fromRight(step2)));
              step2 = head4._3;
            } else {
              head4._3 = fail;
            }
            break;
          case APPLY:
            lhs = head4._1._3;
            rhs = head4._2._3;
            if (fail) {
              head4._3 = fail;
              tmp = true;
              kid = killId++;
              kills[kid] = kill(early, fail === lhs ? head4._2 : head4._1, function() {
                return function() {
                  delete kills[kid];
                  if (tmp) {
                    tmp = false;
                  } else if (tail2 === null) {
                    join2(fail, null, null);
                  } else {
                    join2(fail, tail2._1, tail2._2);
                  }
                };
              });
              if (tmp) {
                tmp = false;
                return;
              }
            } else if (lhs === EMPTY || rhs === EMPTY) {
              return;
            } else {
              step2 = util.right(util.fromRight(lhs)(util.fromRight(rhs)));
              head4._3 = step2;
            }
            break;
          case ALT:
            lhs = head4._1._3;
            rhs = head4._2._3;
            if (lhs === EMPTY && util.isLeft(rhs) || rhs === EMPTY && util.isLeft(lhs)) {
              return;
            }
            if (lhs !== EMPTY && util.isLeft(lhs) && rhs !== EMPTY && util.isLeft(rhs)) {
              fail = step2 === lhs ? rhs : lhs;
              step2 = null;
              head4._3 = fail;
            } else {
              head4._3 = step2;
              tmp = true;
              kid = killId++;
              kills[kid] = kill(early, step2 === lhs ? head4._2 : head4._1, function() {
                return function() {
                  delete kills[kid];
                  if (tmp) {
                    tmp = false;
                  } else if (tail2 === null) {
                    join2(step2, null, null);
                  } else {
                    join2(step2, tail2._1, tail2._2);
                  }
                };
              });
              if (tmp) {
                tmp = false;
                return;
              }
            }
            break;
        }
        if (tail2 === null) {
          head4 = null;
        } else {
          head4 = tail2._1;
          tail2 = tail2._2;
        }
      }
    }
    function resolve(fiber) {
      return function(result2) {
        return function() {
          delete fibers[fiber._1];
          fiber._3 = result2;
          join2(result2, fiber._2._1, fiber._2._2);
        };
      };
    }
    function run3() {
      var status = CONTINUE;
      var step2 = par;
      var head4 = null;
      var tail2 = null;
      var tmp, fid;
      loop: while (true) {
        tmp = null;
        fid = null;
        switch (status) {
          case CONTINUE:
            switch (step2.tag) {
              case MAP:
                if (head4) {
                  tail2 = new Aff2(CONS, head4, tail2);
                }
                head4 = new Aff2(MAP, step2._1, EMPTY, EMPTY);
                step2 = step2._2;
                break;
              case APPLY:
                if (head4) {
                  tail2 = new Aff2(CONS, head4, tail2);
                }
                head4 = new Aff2(APPLY, EMPTY, step2._2, EMPTY);
                step2 = step2._1;
                break;
              case ALT:
                if (head4) {
                  tail2 = new Aff2(CONS, head4, tail2);
                }
                head4 = new Aff2(ALT, EMPTY, step2._2, EMPTY);
                step2 = step2._1;
                break;
              default:
                fid = fiberId++;
                status = RETURN;
                tmp = step2;
                step2 = new Aff2(FORKED, fid, new Aff2(CONS, head4, tail2), EMPTY);
                tmp = Fiber(util, supervisor, tmp);
                tmp.onComplete({
                  rethrow: false,
                  handler: resolve(step2)
                })();
                fibers[fid] = tmp;
                if (supervisor) {
                  supervisor.register(tmp);
                }
            }
            break;
          case RETURN:
            if (head4 === null) {
              break loop;
            }
            if (head4._1 === EMPTY) {
              head4._1 = step2;
              status = CONTINUE;
              step2 = head4._2;
              head4._2 = EMPTY;
            } else {
              head4._2 = step2;
              step2 = head4;
              if (tail2 === null) {
                head4 = null;
              } else {
                head4 = tail2._1;
                tail2 = tail2._2;
              }
            }
        }
      }
      root = step2;
      for (fid = 0; fid < fiberId; fid++) {
        fibers[fid].run();
      }
    }
    function cancel(error2, cb2) {
      interrupt = util.left(error2);
      var innerKills;
      for (var kid in kills) {
        if (kills.hasOwnProperty(kid)) {
          innerKills = kills[kid];
          for (kid in innerKills) {
            if (innerKills.hasOwnProperty(kid)) {
              innerKills[kid]();
            }
          }
        }
      }
      kills = null;
      var newKills = kill(error2, root, cb2);
      return function(killError) {
        return new Aff2(ASYNC, function(killCb) {
          return function() {
            for (var kid2 in newKills) {
              if (newKills.hasOwnProperty(kid2)) {
                newKills[kid2]();
              }
            }
            return nonCanceler;
          };
        });
      };
    }
    run3();
    return function(killError) {
      return new Aff2(ASYNC, function(killCb) {
        return function() {
          return cancel(killError, killCb);
        };
      });
    };
  }
  function sequential2(util, supervisor, par) {
    return new Aff2(ASYNC, function(cb) {
      return function() {
        return runPar(util, supervisor, par, cb);
      };
    });
  }
  Aff2.EMPTY = EMPTY;
  Aff2.Pure = AffCtr(PURE);
  Aff2.Throw = AffCtr(THROW);
  Aff2.Catch = AffCtr(CATCH);
  Aff2.Sync = AffCtr(SYNC);
  Aff2.Async = AffCtr(ASYNC);
  Aff2.Bind = AffCtr(BIND);
  Aff2.Bracket = AffCtr(BRACKET);
  Aff2.Fork = AffCtr(FORK);
  Aff2.Seq = AffCtr(SEQ);
  Aff2.ParMap = AffCtr(MAP);
  Aff2.ParApply = AffCtr(APPLY);
  Aff2.ParAlt = AffCtr(ALT);
  Aff2.Fiber = Fiber;
  Aff2.Supervisor = Supervisor;
  Aff2.Scheduler = Scheduler;
  Aff2.nonCanceler = nonCanceler;
  return Aff2;
})();
var _pure = Aff.Pure;
var _throwError = Aff.Throw;
var _liftEffect = Aff.Sync;
var makeAff = Aff.Async;
var _sequential = Aff.Seq;

// output/RawBars.Lexer/index.js
var eq19 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var notEq9 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var elem21 = /* @__PURE__ */ elem2(eqChar);
var fromFoldable21 = /* @__PURE__ */ fromFoldable(foldableList);
var bind19 = /* @__PURE__ */ bind(bindMaybe);
var map34 = /* @__PURE__ */ map(functorEither);
var elem110 = /* @__PURE__ */ elem2(eqString);
var RContent3 = /* @__PURE__ */ (function() {
  function RContent4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RContent4.create = function(value0) {
    return function(value1) {
      return new RContent4(value0, value1);
    };
  };
  return RContent4;
})();
var ROutput2 = /* @__PURE__ */ (function() {
  function ROutput3(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  ROutput3.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new ROutput3(value0, value1, value2, value3);
        };
      };
    };
  };
  return ROutput3;
})();
var RAmp3 = /* @__PURE__ */ (function() {
  function RAmp4(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RAmp4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RAmp4(value0, value1, value2, value3);
        };
      };
    };
  };
  return RAmp4;
})();
var ROpen3 = /* @__PURE__ */ (function() {
  function ROpen4(value0, value1, value2, value3, value4) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
  }
  ;
  ROpen4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return new ROpen4(value0, value1, value2, value3, value4);
          };
        };
      };
    };
  };
  return ROpen4;
})();
var RClose3 = /* @__PURE__ */ (function() {
  function RClose4(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RClose4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RClose4(value0, value1, value2, value3);
        };
      };
    };
  };
  return RClose4;
})();
var RSep4 = /* @__PURE__ */ (function() {
  function RSep5(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RSep5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RSep5(value0, value1, value2, value3);
        };
      };
    };
  };
  return RSep5;
})();
var RRaw4 = /* @__PURE__ */ (function() {
  function RRaw5(value0, value1, value2, value3, value4, value5) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
    this.value5 = value5;
  }
  ;
  RRaw5.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return function(value5) {
              return new RRaw5(value0, value1, value2, value3, value4, value5);
            };
          };
        };
      };
    };
  };
  return RRaw5;
})();
var RComment3 = /* @__PURE__ */ (function() {
  function RComment4(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RComment4.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RComment4(value0, value1, value2);
      };
    };
  };
  return RComment4;
})();
var RSetDelim2 = /* @__PURE__ */ (function() {
  function RSetDelim3(value0) {
    this.value0 = value0;
  }
  ;
  RSetDelim3.create = function(value0) {
    return new RSetDelim3(value0);
  };
  return RSetDelim3;
})();
var RLongComment2 = /* @__PURE__ */ (function() {
  function RLongComment3(value0) {
    this.value0 = value0;
  }
  ;
  RLongComment3.create = function(value0) {
    return new RLongComment3(value0);
  };
  return RLongComment3;
})();
var RError3 = /* @__PURE__ */ (function() {
  function RError4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RError4.create = function(value0) {
    return function(value1) {
      return new RError4(value0, value1);
    };
  };
  return RError4;
})();
var slice5 = function(cs) {
  return function(i) {
    return function(j) {
      return fromCharArray(slice(i)(j)(cs));
    };
  };
};
var nlIndex4 = function(first) {
  return function(s) {
    var f = (function() {
      if (first) {
        return findIndex;
      }
      ;
      return findLastIndex;
    })();
    return f(function(v) {
      return v === "\n";
    })(toCharArray(s));
  };
};
var matchAt4 = function(cs) {
  return function(i) {
    return function(pat) {
      var pcs = toCharArray(pat);
      return eq19(slice(i)(i + length(pcs) | 0)(cs))(pcs);
    };
  };
};
var isStmtSep2 = function(h) {
  return h === "else" || (h === "elif" || h === "when");
};
var isStmtClose2 = function(h) {
  return take2(3)(h) === "end" && length2(h) > 3;
};
var isSpace7 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var sepHead3 = function(s) {
  var cs = dropWhile(isSpace7)(toCharArray(s));
  return fromCharArray(takeWhile(function($450) {
    return !isSpace7($450);
  })(cs));
};
var trimEndWs3 = function(s) {
  return fromCharArray(reverse(dropWhile(isSpace7)(reverse(toCharArray(s)))));
};
var trimStartWs3 = function(s) {
  return fromCharArray(dropWhile(isSpace7)(toCharArray(s)));
};
var hasNL4 = function(s) {
  return notEq9(nlIndex4(true)(s))(Nothing.value);
};
var firstWord3 = function(s) {
  return fromCharArray(takeWhile(function($451) {
    return !isSpace7($451);
  })(dropWhile(isSpace7)(toCharArray(s))));
};
var findFrom4 = function(cs) {
  return function(from2) {
    return function(pat) {
      var len = length(cs);
      var go = function($copy_i) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i) {
          if (i > len) {
            $tco_done = true;
            return Nothing.value;
          }
          ;
          if (matchAt4(cs)(i)(pat)) {
            $tco_done = true;
            return new Just(i);
          }
          ;
          if (otherwise) {
            $copy_i = i + 1 | 0;
            return;
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 118, column 3 - line 121, column 29): " + [i.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_i);
        }
        ;
        return $tco_result;
      };
      return go(from2);
    };
  };
};
var tokenizeTemplate3 = function(cfg) {
  return function(src) {
    var validDelim = function(d) {
      return !elem21("=")(toCharArray(d));
    };
    var trimMark = (function() {
      if (cfg.statementTags) {
        return "-";
      }
      ;
      return "~";
    })();
    var splitTrims = function(raw) {
      var trimL = take2(1)(raw) === trimMark;
      var r1 = (function() {
        if (trimL) {
          return drop2(1)(raw);
        }
        ;
        return raw;
      })();
      var trimR = takeRight(1)(r1) === trimMark;
      var core = (function() {
        if (trimR) {
          return dropRight(1)(r1);
        }
        ;
        return r1;
      })();
      return {
        trimL,
        trimR,
        core
      };
    };
    var rawName = function(s) {
      return fromCharArray(takeWhile(function($452) {
        return !isSpace7($452);
      })(dropWhile(isSpace7)(toCharArray(s))));
    };
    var interiorAt = function(base) {
      return function(s) {
        return tokenizeInterior(base)(s);
      };
    };
    var flush = function(span2) {
      return function(s0) {
        return function(acc) {
          return function(pend) {
            return function(trimR) {
              var s1 = (function() {
                if (pend) {
                  return trimStartWs3(s0);
                }
                ;
                return s0;
              })();
              var s2 = (function() {
                if (trimR) {
                  return trimEndWs3(s1);
                }
                ;
                return s1;
              })();
              var $215 = s2 === "";
              if ($215) {
                return acc;
              }
              ;
              return new Cons(new RContent3(span2, s2), acc);
            };
          };
        };
      };
    };
    var finalize = function($453) {
      return fromFoldable21(reverse2($453));
    };
    var delimWords = function(s) {
      var a0 = dropWhile(isSpace7)(toCharArray(s));
      var a1 = dropWhile(isSpace7)(dropWhile(function($454) {
        return !isSpace7($454);
      })(a0));
      var rest = dropWhile(isSpace7)(dropWhile(function($455) {
        return !isSpace7($455);
      })(a1));
      var w2 = takeWhile(function($456) {
        return !isSpace7($456);
      })(a1);
      var w1 = takeWhile(function($457) {
        return !isSpace7($457);
      })(a0);
      var $216 = $$null(w1) || ($$null(w2) || !$$null(rest));
      if ($216) {
        return Nothing.value;
      }
      ;
      return new Just({
        open: fromCharArray(w1),
        close: fromCharArray(w2)
      });
    };
    var parseDelimDirective = function(interior) {
      var t = trimStartWs3(interior);
      var v = bind19(stripPrefix("@delimiters")(t))((function() {
        var $458 = stripPrefix(":");
        return function($459) {
          return $458(trimStartWs3($459));
        };
      })());
      if (v instanceof Nothing) {
        return Nothing.value;
      }
      ;
      if (v instanceof Just) {
        return new Just((function() {
          var v1 = delimWords(v.value0);
          if (v1 instanceof Just && (validDelim(v1.value0.open) && validDelim(v1.value0.close))) {
            return new Right(v1.value0);
          }
          ;
          return new Left(new LexError("@delimiters expects two whitespace-separated delimiters (no '=')", 0));
        })());
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 545, column 7 - line 552, column 100): " + [v.constructor.name]);
    };
    var delimSwitch = function(v) {
      if (v instanceof Just && (v.value0 instanceof RComment3 && cfg.mustacheDelims)) {
        var v1 = parseDelimDirective(v.value0.value2);
        if (v1 instanceof Nothing) {
          return new Right(Nothing.value);
        }
        ;
        if (v1 instanceof Just && v1.value0 instanceof Left) {
          return new Left(v1.value0.value0);
        }
        ;
        if (v1 instanceof Just && v1.value0 instanceof Right) {
          return new Right(new Just(v1.value0.value0));
        }
        ;
        throw new Error("Failed pattern match at RawBars.Lexer (line 532, column 58 - line 535, column 39): " + [v1.constructor.name]);
      }
      ;
      return new Right(Nothing.value);
    };
    var cs = toCharArray(src);
    var leadTrimAt = function(i) {
      return matchAt4(cs)(i + 2 | 0)(trimMark);
    };
    var len = length(cs);
    var openerLiteralAt = function(i) {
      if (matchAt4(cs)(i)("{{{{#")) {
        return new Just("{{{{#");
      }
      ;
      if (matchAt4(cs)(i)("{{{{")) {
        return new Just("{{{{");
      }
      ;
      if (matchAt4(cs)(i)("{{~!--")) {
        return new Just("{{~!--");
      }
      ;
      if (matchAt4(cs)(i)("{{!--")) {
        return new Just("{{!--");
      }
      ;
      if (matchAt4(cs)(i)("{{{^")) {
        return new Just("{{{^");
      }
      ;
      if (matchAt4(cs)(i)("{{{/")) {
        return new Just("{{{/");
      }
      ;
      if (matchAt4(cs)(i)("{{{")) {
        return new Just("{{{");
      }
      ;
      if (matchAt4(cs)(i)("{{~!")) {
        return new Just("{{~!");
      }
      ;
      if (matchAt4(cs)(i)("{{!")) {
        return new Just("{{!");
      }
      ;
      if (matchAt4(cs)(i)("{{~#")) {
        return new Just("{{~#");
      }
      ;
      if (matchAt4(cs)(i)("{{#")) {
        return new Just("{{#");
      }
      ;
      if (matchAt4(cs)(i)("{{~^")) {
        return new Just("{{~^");
      }
      ;
      if (matchAt4(cs)(i)("{{^")) {
        return new Just("{{^");
      }
      ;
      if (matchAt4(cs)(i)("{{~<")) {
        return new Just("{{~<");
      }
      ;
      if (matchAt4(cs)(i)("{{<")) {
        return new Just("{{<");
      }
      ;
      if (matchAt4(cs)(i)("{{~$")) {
        return new Just("{{~$");
      }
      ;
      if (matchAt4(cs)(i)("{{$")) {
        return new Just("{{$");
      }
      ;
      if (matchAt4(cs)(i)("{{~/")) {
        return new Just("{{~/");
      }
      ;
      if (matchAt4(cs)(i)("{{/")) {
        return new Just("{{/");
      }
      ;
      if (matchAt4(cs)(i)("{{~&")) {
        return new Just("{{~&");
      }
      ;
      if (matchAt4(cs)(i)("{{&")) {
        return new Just("{{&");
      }
      ;
      if (otherwise) {
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 579, column 3 - line 579, column 41): " + [i.constructor.name]);
    };
    var isSeparatorAt = function(i) {
      return matchAt4(cs)(i)("{{") && (!matchAt4(cs)(i)("{{{") && (function() {
        var v = openerLiteralAt(i);
        if (v instanceof Just) {
          return false;
        }
        ;
        if (v instanceof Nothing) {
          return true;
        }
        ;
        throw new Error("Failed pattern match at RawBars.Lexer (line 608, column 70 - line 610, column 20): " + [v.constructor.name]);
      })());
    };
    var escapedOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        var $236 = isSeparatorAt(i);
        if ($236) {
          return new Just("{{");
        }
        ;
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 619, column 23 - line 621, column 62): " + [v.constructor.name]);
    };
    var isOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return true;
      }
      ;
      if (v instanceof Nothing) {
        return isSeparatorAt(i);
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 613, column 18 - line 615, column 31): " + [v.constructor.name]);
    };
    var pushSeg = function(segStart) {
      return function(frags) {
        return function(end) {
          return function(lit) {
            return snoc(snoc(frags)(slice5(cs)(segStart)(end)))(lit);
          };
        };
      };
    };
    var readCustomTag = function(i) {
      return function(open) {
        return function(close) {
          var start = i + length2(open) | 0;
          var cl = length2(close);
          var v = findFrom4(cs)(start)(close);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedTag(i));
          }
          ;
          if (v instanceof Just) {
            var span2 = {
              start: i,
              end: v.value0 + cl | 0
            };
            var next = v.value0 + cl | 0;
            var mk = function(tok) {
              return new Right({
                mtok: new Just(tok),
                next,
                trimL: false,
                trimR: false
              });
            };
            var interior = slice5(cs)(start)(v.value0);
            var afterSig = slice5(cs)(start + 1 | 0)(v.value0);
            var sigOpen = function(sig) {
              return mk(new ROpen3(span2, sig, start + 1 | 0, afterSig, interiorAt(start + 1 | 0)(afterSig)));
            };
            var afterHash = slice5(cs)(start + 2 | 0)(v.value0);
            var hashOpen = function(sig) {
              return mk(new ROpen3(span2, sig, start + 2 | 0, afterHash, interiorAt(start + 2 | 0)(afterHash)));
            };
            var v1 = index(cs)(start);
            if (v1 instanceof Just && v1.value0 === "#") {
              var v2 = index(cs)(start + 1 | 0);
              if (v2 instanceof Just && v2.value0 === "*") {
                return hashOpen(Decorator.value);
              }
              ;
              if (v2 instanceof Just && v2.value0 === ">") {
                return hashOpen(PartialBlock.value);
              }
              ;
              return sigOpen(Section.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "^") {
              return sigOpen(Inverse.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "<") {
              return sigOpen(Parent.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "$") {
              return sigOpen(BlockDef.value);
            }
            ;
            if (v1 instanceof Just && v1.value0 === "/") {
              return mk(new RClose3(span2, start + 1 | 0, afterSig, interiorAt(start + 1 | 0)(afterSig)));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "&") {
              return mk(new RAmp3(span2, start + 1 | 0, afterSig, interiorAt(start + 1 | 0)(afterSig)));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "!") {
              return mk(new RComment3(span2, start + 1 | 0, afterSig));
            }
            ;
            return mk(new RSep4(span2, start, interior, interiorAt(start)(interior)));
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 1052, column 7 - line 1083, column 77): " + [v.constructor.name]);
        };
      };
    };
    var readInlineComment = function(i) {
      var start = i + 2 | 0;
      var v = findFrom4(cs)(start)("#}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedComment(i));
      }
      ;
      if (v instanceof Just) {
        return new Right({
          mtok: new Just(new RComment3({
            start: i,
            end: v.value0 + 2 | 0
          }, start, slice5(cs)(start)(v.value0))),
          next: v.value0 + 2 | 0,
          trimL: false,
          trimR: false
        });
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 930, column 7 - line 938, column 14): " + [v.constructor.name]);
    };
    var readLongComment = function(i) {
      return function(opener) {
        var v = findFrom4(cs)(i + length2(opener) | 0)("--}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedComment(i));
        }
        ;
        if (v instanceof Just) {
          return new Right({
            mtok: (function() {
              if (cfg.keepLongComments) {
                return new Just(new RLongComment2({
                  start: i,
                  end: v.value0 + 4 | 0
                }));
              }
              ;
              return Nothing.value;
            })(),
            next: v.value0 + 4 | 0,
            trimL: leadTrimAt(i),
            trimR: matchAt4(cs)(v.value0 - 1 | 0)("~")
          });
        }
        ;
        throw new Error("Failed pattern match at RawBars.Lexer (line 945, column 30 - line 952, column 8): " + [v.constructor.name]);
      };
    };
    var readRaw = function(i) {
      return function(sigil) {
        var start = i + sigil | 0;
        var v = findFrom4(cs)(start)("}}}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedRaw(i));
        }
        ;
        if (v instanceof Just) {
          var head4 = slice5(cs)(start)(v.value0);
          var closePat = "{{{{/" + (rawName(head4) + "}}}}");
          var bodyStart2 = v.value0 + 4 | 0;
          var v1 = findFrom4(cs)(bodyStart2)(closePat);
          if (v1 instanceof Nothing) {
            return new Left(new UnterminatedRaw(i));
          }
          ;
          if (v1 instanceof Just) {
            var end = v1.value0 + length2(closePat) | 0;
            return new Right({
              mtok: new Just(new RRaw4({
                start: i,
                end
              }, sigil === 5, start, head4, interiorAt(start)(head4), slice5(cs)(bodyStart2)(v1.value0))),
              next: end,
              trimL: false,
              trimR: false
            });
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 972, column 13 - line 986, column 22): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at RawBars.Lexer (line 961, column 7 - line 986, column 22): " + [v.constructor.name]);
      };
    };
    var readSetDelim = function(i) {
      return function(open) {
        return function(close) {
          var start = (i + length2(open) | 0) + 1 | 0;
          var closePat = "=" + close;
          var v = findFrom4(cs)(start)(closePat);
          if (v instanceof Nothing) {
            return new Left(new LexError("unterminated set-delimiter tag (expected '=" + (close + "')"), i));
          }
          ;
          if (v instanceof Just) {
            var v1 = delimWords(slice5(cs)(start)(v.value0));
            if (v1 instanceof Nothing) {
              return new Left(new LexError("set-delimiter expects two whitespace-separated delimiters", i));
            }
            ;
            if (v1 instanceof Just) {
              if (validDelim(v1.value0.open) && validDelim(v1.value0.close)) {
                return new Right({
                  tok: new RSetDelim2({
                    start: i,
                    end: v.value0 + length2(closePat) | 0
                  }),
                  next: v.value0 + length2(closePat) | 0,
                  open: v1.value0.open,
                  close: v1.value0.close,
                  trimL: false,
                  trimR: false
                });
              }
              ;
              if (otherwise) {
                return new Left(new LexError("set-delimiter values may not contain '='", i));
              }
              ;
            }
            ;
            throw new Error("Failed pattern match at RawBars.Lexer (line 1008, column 19 - line 1019, column 88): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 1005, column 7 - line 1019, column 88): " + [v.constructor.name]);
        };
      };
    };
    var readShortComment = function(i) {
      return function(opener) {
        var start = i + length2(opener) | 0;
        var v = findFrom4(cs)(start)("}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedComment(i));
        }
        ;
        if (v instanceof Just) {
          var trimR = matchAt4(cs)(v.value0 - 1 | 0)("~");
          var interior = slice5(cs)(start)((function() {
            if (trimR) {
              return v.value0 - 1 | 0;
            }
            ;
            return v.value0;
          })());
          return new Right({
            mtok: new Just(new RComment3({
              start: i,
              end: v.value0 + 2 | 0
            }, start, interior)),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i),
            trimR
          });
        }
        ;
        throw new Error("Failed pattern match at RawBars.Lexer (line 907, column 7 - line 919, column 16): " + [v.constructor.name]);
      };
    };
    var contentTo = function(segStart) {
      return function(frags) {
        return function(end) {
          return joinWith("")(snoc(frags)(slice5(cs)(segStart)(end)));
        };
      };
    };
    var consTok = function(mtok) {
      return function(acc1) {
        return maybe(acc1)(function(t) {
          return new Cons(t, acc1);
        })(mtok);
      };
    };
    var closeFrom = function(from2) {
      return function(close) {
        return findFrom4(cs)(from2)(close);
      };
    };
    var findEndrawFrom = /* @__PURE__ */ (function() {
      var scan = function($copy_j) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(j) {
          if (j >= len) {
            $tco_done = true;
            return Nothing.value;
          }
          ;
          if (matchAt4(cs)(j)("{%")) {
            var v = closeFrom(j + 2 | 0)("%}");
            if (v instanceof Just) {
              if (firstWord3(splitTrims(slice5(cs)(j + 2 | 0)(v.value0)).core) === "endraw") {
                $tco_done = true;
                return new Just({
                  tagStart: j,
                  tagEnd: v.value0 + 2 | 0
                });
              }
              ;
              if (otherwise) {
                $copy_j = v.value0 + 2 | 0;
                return;
              }
              ;
            }
            ;
            if (v instanceof Nothing) {
              $copy_j = j + 1 | 0;
              return;
            }
            ;
            throw new Error("Failed pattern match at RawBars.Lexer (line 888, column 29 - line 893, column 34): " + [v.constructor.name]);
          }
          ;
          if (otherwise) {
            $copy_j = j + 1 | 0;
            return;
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 886, column 5 - line 894, column 33): " + [j.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_j);
        }
        ;
        return $tco_result;
      };
      return scan;
    })();
    var readRawBody = function(i) {
      return function(headStart) {
        return function(bodyStart2) {
          var v = findEndrawFrom(bodyStart2);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedRaw(i));
          }
          ;
          if (v instanceof Just) {
            return new Right({
              mtok: new Just(new RRaw4({
                start: i,
                end: v.value0.tagEnd
              }, true, headStart, "raw", interiorAt(headStart)("raw"), slice5(cs)(bodyStart2)(v.value0.tagStart))),
              next: v.value0.tagEnd,
              trimL: leadTrimAt(i),
              trimR: false
            });
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 867, column 39 - line 878, column 8): " + [v.constructor.name]);
        };
      };
    };
    var readAmp = function(i) {
      return function(opener) {
        var start = i + length2(opener) | 0;
        var v = closeFrom(start)("}}");
        if (v instanceof Nothing) {
          return new Left(new UnterminatedTag(i));
        }
        ;
        if (v instanceof Just) {
          var t = splitTrims(slice5(cs)(start)(v.value0));
          return new Right({
            mtok: new Just(new RAmp3({
              start: i,
              end: v.value0 + 2 | 0
            }, start, t.core, interiorAt(start)(t.core))),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i) || t.trimL,
            trimR: t.trimR
          });
        }
        ;
        throw new Error("Failed pattern match at RawBars.Lexer (line 762, column 7 - line 773, column 16): " + [v.constructor.name]);
      };
    };
    var readBlockOpen = function(i) {
      return function(opener) {
        return function(sigil) {
          return function(close) {
            var start = i + length2(opener) | 0;
            var cl = length2(close);
            var v = closeFrom(start)(close);
            if (v instanceof Nothing) {
              return new Left(new UnterminatedTag(i));
            }
            ;
            if (v instanceof Just) {
              var t = splitTrims(slice5(cs)(start)(v.value0));
              return new Right({
                mtok: new Just(new ROpen3({
                  start: i,
                  end: v.value0 + cl | 0
                }, sigil, start, t.core, interiorAt(start)(t.core))),
                next: v.value0 + cl | 0,
                trimL: leadTrimAt(i) || t.trimL,
                trimR: t.trimR
              });
            }
            ;
            throw new Error("Failed pattern match at RawBars.Lexer (line 721, column 7 - line 733, column 16): " + [v.constructor.name]);
          };
        };
      };
    };
    var readClose = function(i) {
      return function(opener) {
        return function(close) {
          var start = i + length2(opener) | 0;
          var cl = length2(close);
          var v = closeFrom(start)(close);
          if (v instanceof Nothing) {
            return new Left(new UnterminatedTag(i));
          }
          ;
          if (v instanceof Just) {
            var t = splitTrims(slice5(cs)(start)(v.value0));
            return new Right({
              mtok: new Just(new RClose3({
                start: i,
                end: v.value0 + cl | 0
              }, start, t.core, interiorAt(start)(t.core))),
              next: v.value0 + cl | 0,
              trimL: leadTrimAt(i) || t.trimL,
              trimR: t.trimR
            });
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 743, column 7 - line 754, column 16): " + [v.constructor.name]);
        };
      };
    };
    var readOutput = function(i) {
      var start = i + 3 | 0;
      var v = closeFrom(start)("}}}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice5(cs)(start)(v.value0));
        return new Right({
          mtok: new Just(new ROutput2({
            start: i,
            end: v.value0 + 3 | 0
          }, start, t.core, interiorAt(start)(t.core))),
          next: v.value0 + 3 | 0,
          trimL: t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 699, column 7 - line 710, column 16): " + [v.constructor.name]);
    };
    var readSeparator = function(i) {
      var start = (function() {
        var $281 = leadTrimAt(i);
        if ($281) {
          return i + 3 | 0;
        }
        ;
        return i + 2 | 0;
      })();
      var v = closeFrom(start)("}}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice5(cs)(start)(v.value0));
        return new Right({
          mtok: new Just(new RSep4({
            start: i,
            end: v.value0 + 2 | 0
          }, start, t.core, interiorAt(start)(t.core))),
          next: v.value0 + 2 | 0,
          trimL: leadTrimAt(i) || t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 783, column 7 - line 794, column 16): " + [v.constructor.name]);
    };
    var readTag = function(i) {
      if (matchAt4(cs)(i)("{{{{#")) {
        return readRaw(i)(5);
      }
      ;
      if (matchAt4(cs)(i)("{{{{")) {
        return readRaw(i)(4);
      }
      ;
      if (!cfg.bracesOutputOnly && matchAt4(cs)(i)("{{~!--")) {
        return readLongComment(i)("{{~!--");
      }
      ;
      if (!cfg.bracesOutputOnly && matchAt4(cs)(i)("{{!--")) {
        return readLongComment(i)("{{!--");
      }
      ;
      if (cfg.bracesOutputOnly && matchAt4(cs)(i)("{{{")) {
        return new Left(new LexError("`{{{ \u2026 }}}` is not a tag here \u2014 unescaped output is `{{ x | safe }}`, a verbatim region is `{% raw %}`", i));
      }
      ;
      if (matchAt4(cs)(i)("{{{^")) {
        return readBlockOpen(i)("{{{^")(Inverse.value)("}}}");
      }
      ;
      if (matchAt4(cs)(i)("{{{/")) {
        return readClose(i)("{{{/")("}}}");
      }
      ;
      if (matchAt4(cs)(i)("{{{")) {
        return readOutput(i);
      }
      ;
      if (!cfg.bracesOutputOnly && matchAt4(cs)(i)("{{~!")) {
        return readShortComment(i)("{{~!");
      }
      ;
      if (!cfg.bracesOutputOnly && matchAt4(cs)(i)("{{!")) {
        return readShortComment(i)("{{!");
      }
      ;
      if (matchAt4(cs)(i)("{{~#*")) {
        return readBlockOpen(i)("{{~#*")(Decorator.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{#*")) {
        return readBlockOpen(i)("{{#*")(Decorator.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~#>")) {
        return readBlockOpen(i)("{{~#>")(PartialBlock.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{#>")) {
        return readBlockOpen(i)("{{#>")(PartialBlock.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~#")) {
        return readBlockOpen(i)("{{~#")(Section.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{#")) {
        return readBlockOpen(i)("{{#")(Section.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~^")) {
        return readBlockOpen(i)("{{~^")(Inverse.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{^")) {
        return readBlockOpen(i)("{{^")(Inverse.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~<")) {
        return readBlockOpen(i)("{{~<")(Parent.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{<")) {
        return readBlockOpen(i)("{{<")(Parent.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~$")) {
        return readBlockOpen(i)("{{~$")(BlockDef.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{$")) {
        return readBlockOpen(i)("{{$")(BlockDef.value)("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~/")) {
        return readClose(i)("{{~/")("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{/")) {
        return readClose(i)("{{/")("}}");
      }
      ;
      if (matchAt4(cs)(i)("{{~&")) {
        return readAmp(i)("{{~&");
      }
      ;
      if (matchAt4(cs)(i)("{{&")) {
        return readAmp(i)("{{&");
      }
      ;
      if (matchAt4(cs)(i)("{{")) {
        return readSeparator(i);
      }
      ;
      if (otherwise) {
        return new Left(new LexError("internal: no opener", i));
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 623, column 3 - line 623, column 48): " + [i.constructor.name]);
    };
    var readStatementTag = function(i) {
      var start = (function() {
        var $285 = leadTrimAt(i);
        if ($285) {
          return i + 3 | 0;
        }
        ;
        return i + 2 | 0;
      })();
      var v = closeFrom(start)("%}");
      if (v instanceof Nothing) {
        return new Left(new UnterminatedTag(i));
      }
      ;
      if (v instanceof Just) {
        var t = splitTrims(slice5(cs)(start)(v.value0));
        var span2 = {
          start: i,
          end: v.value0 + 2 | 0
        };
        var mk = function(tok) {
          return new Right({
            mtok: new Just(tok),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i) || t.trimL,
            trimR: t.trimR
          });
        };
        var headWord4 = firstWord3(t.core);
        var $287 = headWord4 === "";
        if ($287) {
          return new Left(new LexError("empty statement tag '{% %}'", i));
        }
        ;
        var $288 = trim(t.core) === "raw";
        if ($288) {
          return readRawBody(i)(start)(v.value0 + 2 | 0);
        }
        ;
        var $289 = isStmtClose2(headWord4);
        if ($289) {
          var name2 = drop2(3)(headWord4);
          return mk(new RClose3(span2, start, name2, interiorAt(start)(name2)));
        }
        ;
        var $290 = isStmtSep2(headWord4) || (headWord4 === "set" || (trim(t.core) === "yield" || trim(t.core) === "super"));
        if ($290) {
          return mk(new RSep4(span2, start, t.core, interiorAt(start)(t.core)));
        }
        ;
        var $291 = headWord4 === "extends";
        if ($291) {
          return mk(new RSep4(span2, start, t.core, interiorAt(start)(t.core)));
        }
        ;
        var $292 = headWord4 === "include";
        if ($292) {
          var skipSp = function($copy_j) {
            var $tco_done1 = false;
            var $tco_result;
            function $tco_loop(j) {
              var $293 = j < v.value0 && maybe(false)(isSpace7)(index(cs)(j));
              if ($293) {
                $copy_j = j + 1 | 0;
                return;
              }
              ;
              $tco_done1 = true;
              return j;
            }
            ;
            while (!$tco_done1) {
              $tco_result = $tco_loop($copy_j);
            }
            ;
            return $tco_result;
          };
          var argsOff = skipSp(skipSp(start) + length2(headWord4) | 0);
          var pcore = "> " + slice5(cs)(argsOff)(v.value0);
          return mk(new RSep4(span2, start, pcore, interiorAt(argsOff - 2 | 0)(pcore)));
        }
        ;
        return mk(new ROpen3(span2, Section.value, start, t.core, interiorAt(start)(t.core)));
      }
      ;
      throw new Error("Failed pattern match at RawBars.Lexer (line 806, column 7 - line 860, column 73): " + [v.constructor.name]);
    };
    var recoverFrom = function(i) {
      return function(e) {
        return function(segStart) {
          return function(frags) {
            return function(acc) {
              return function(pend) {
                return function(open) {
                  return function(close) {
                    var resync = fromMaybe(len)(findFrom4(cs)(i + length2(open) | 0)(open));
                    var acc2 = new Cons(new RError3({
                      start: i,
                      end: resync
                    }, e), flush({
                      start: segStart,
                      end: i
                    })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                    return go(resync)(open)(close)(resync)([])(acc2)(false);
                  };
                };
              };
            };
          };
        };
      };
    };
    var go = function($copy_i) {
      return function($copy_open) {
        return function($copy_close) {
          return function($copy_segStart) {
            return function($copy_frags) {
              return function($copy_acc) {
                return function($copy_pend) {
                  var $tco_var_i = $copy_i;
                  var $tco_var_open = $copy_open;
                  var $tco_var_close = $copy_close;
                  var $tco_var_segStart = $copy_segStart;
                  var $tco_var_frags = $copy_frags;
                  var $tco_var_acc = $copy_acc;
                  var $tco_done2 = false;
                  var $tco_result;
                  function $tco_loop(i, open, close, segStart, frags, acc, pend) {
                    if (i >= len) {
                      $tco_done2 = true;
                      return new Right(flush({
                        start: segStart,
                        end: i
                      })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                    }
                    ;
                    if (otherwise) {
                      var v = index(cs)(i);
                      if (v instanceof Nothing) {
                        $tco_done2 = true;
                        return new Right(flush({
                          start: segStart,
                          end: i
                        })(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                      }
                      ;
                      if (v instanceof Just) {
                        if (cfg.mustacheDelims && matchAt4(cs)(i)(open + "=")) {
                          var v1 = readSetDelim(i)(open)(close);
                          if (v1 instanceof Left) {
                            $tco_done2 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc11 = flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL);
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = v1.value0.open;
                            $tco_var_close = v1.value0.close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = new Cons(v1.value0.tok, acc11);
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at RawBars.Lexer (line 412, column 65 - line 419, column 82): " + [v1.constructor.name]);
                        }
                        ;
                        if (cfg.statementTags && matchAt4(cs)(i)("{%")) {
                          var v1 = readStatementTag(i);
                          if (v1 instanceof Left) {
                            $tco_done2 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = acc2;
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at RawBars.Lexer (line 423, column 55 - line 432, column 68): " + [v1.constructor.name]);
                        }
                        ;
                        if (cfg.statementTags && matchAt4(cs)(i)("{#")) {
                          var v1 = readInlineComment(i);
                          if (v1 instanceof Left) {
                            $tco_done2 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            $tco_var_i = v1.value0.next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = v1.value0.next;
                            $tco_var_frags = [];
                            $tco_var_acc = acc2;
                            $copy_pend = v1.value0.trimR;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at RawBars.Lexer (line 437, column 55 - line 446, column 68): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && (close === "}}" && v.value0 === "\\")) {
                          var $312 = matchAt4(cs)(i + 1 | 0)("\\");
                          if ($312) {
                            $tco_var_i = i + 2 | 0;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = i + 2 | 0;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)("\\");
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          var v1 = escapedOpenerAt(i + 1 | 0);
                          if (v1 instanceof Just) {
                            var next = (i + 1 | 0) + length2(v1.value0) | 0;
                            $tco_var_i = next;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = next;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)(v1.value0);
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          if (v1 instanceof Nothing) {
                            $tco_var_i = i + 1 | 0;
                            $tco_var_open = open;
                            $tco_var_close = close;
                            $tco_var_segStart = i + 1 | 0;
                            $tco_var_frags = pushSeg(segStart)(frags)(i)("\\");
                            $tco_var_acc = acc;
                            $copy_pend = pend;
                            return;
                          }
                          ;
                          throw new Error("Failed pattern match at RawBars.Lexer (line 454, column 20 - line 460, column 98): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && (close === "}}" && (v.value0 === "{" && isOpenerAt(i)))) {
                          var v1 = readTag(i);
                          if (v1 instanceof Left) {
                            $tco_done2 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            var v2 = delimSwitch(v1.value0.mtok);
                            if (v2 instanceof Left) {
                              $tco_done2 = true;
                              return new Left(v2.value0);
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Nothing) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = open;
                              $tco_var_close = close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Just) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = v2.value0.value0.open;
                              $tco_var_close = v2.value0.value0.close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            throw new Error("Failed pattern match at RawBars.Lexer (line 470, column 19 - line 473, column 92): " + [v2.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at RawBars.Lexer (line 461, column 74 - line 473, column 92): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && close === "}}") {
                          $tco_var_i = i + 1 | 0;
                          $tco_var_open = open;
                          $tco_var_close = close;
                          $tco_var_segStart = segStart;
                          $tco_var_frags = frags;
                          $tco_var_acc = acc;
                          $copy_pend = pend;
                          return;
                        }
                        ;
                        if (matchAt4(cs)(i)(open)) {
                          var v1 = readCustomTag(i)(open)(close);
                          if (v1 instanceof Left) {
                            $tco_done2 = true;
                            return recoverFrom(i)(v1.value0)(segStart)(frags)(acc)(pend)(open)(close);
                          }
                          ;
                          if (v1 instanceof Right) {
                            var acc2 = consTok(v1.value0.mtok)(flush({
                              start: segStart,
                              end: i
                            })(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
                            var v2 = delimSwitch(v1.value0.mtok);
                            if (v2 instanceof Left) {
                              $tco_done2 = true;
                              return new Left(v2.value0);
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Nothing) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = open;
                              $tco_var_close = close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            if (v2 instanceof Right && v2.value0 instanceof Just) {
                              $tco_var_i = v1.value0.next;
                              $tco_var_open = v2.value0.value0.open;
                              $tco_var_close = v2.value0.value0.close;
                              $tco_var_segStart = v1.value0.next;
                              $tco_var_frags = [];
                              $tco_var_acc = acc2;
                              $copy_pend = v1.value0.trimR;
                              return;
                            }
                            ;
                            throw new Error("Failed pattern match at RawBars.Lexer (line 486, column 19 - line 489, column 92): " + [v2.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at RawBars.Lexer (line 477, column 34 - line 489, column 92): " + [v1.constructor.name]);
                        }
                        ;
                        if (otherwise) {
                          $tco_var_i = i + 1 | 0;
                          $tco_var_open = open;
                          $tco_var_close = close;
                          $tco_var_segStart = segStart;
                          $tco_var_frags = frags;
                          $tco_var_acc = acc;
                          $copy_pend = pend;
                          return;
                        }
                        ;
                      }
                      ;
                      throw new Error("Failed pattern match at RawBars.Lexer (line 405, column 19 - line 490, column 71): " + [v.constructor.name]);
                    }
                    ;
                    throw new Error("Failed pattern match at RawBars.Lexer (line 393, column 3 - line 401, column 39): " + [i.constructor.name, open.constructor.name, close.constructor.name, segStart.constructor.name, frags.constructor.name, acc.constructor.name, pend.constructor.name]);
                  }
                  ;
                  while (!$tco_done2) {
                    $tco_result = $tco_loop($tco_var_i, $tco_var_open, $tco_var_close, $tco_var_segStart, $tco_var_frags, $tco_var_acc, $copy_pend);
                  }
                  ;
                  return $tco_result;
                };
              };
            };
          };
        };
      };
    };
    return map34(finalize)(go(0)(cfg.open)(cfg.close)(0)([])(Nil.value)(false));
  };
};
var dropTrailingIndent4 = function(s) {
  var v = nlIndex4(false)(s);
  if (v instanceof Just) {
    return take2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at RawBars.Lexer (line 276, column 24 - line 278, column 16): " + [v.constructor.name]);
};
var dropLeadingLine4 = function(s) {
  var v = nlIndex4(true)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return "";
  }
  ;
  throw new Error("Failed pattern match at RawBars.Lexer (line 269, column 21 - line 271, column 16): " + [v.constructor.name]);
};
var defaultLexConfig3 = {
  open: "{{",
  close: "}}",
  mustacheDelims: false,
  keepLongComments: false,
  statementTags: false,
  bracesOutputOnly: false
};
var rawLexConfig = function(keepLongComments) {
  return {
    open: defaultLexConfig3.open,
    close: defaultLexConfig3.close,
    mustacheDelims: defaultLexConfig3.mustacheDelims,
    bracesOutputOnly: defaultLexConfig3.bracesOutputOnly,
    statementTags: true,
    keepLongComments
  };
};
var blockLevel3 = function(v) {
  if (v instanceof ROpen3) {
    return true;
  }
  ;
  if (v instanceof RClose3) {
    return true;
  }
  ;
  if (v instanceof RComment3) {
    return true;
  }
  ;
  if (v instanceof RSetDelim2) {
    return true;
  }
  ;
  return false;
};
var beforeFirstNL4 = function(s) {
  var v = nlIndex4(true)(s);
  if (v instanceof Just) {
    return take2(v.value0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at RawBars.Lexer (line 262, column 19 - line 264, column 15): " + [v.constructor.name]);
};
var allWs4 = /* @__PURE__ */ (function() {
  var $460 = all2(isSpace7);
  return function($461) {
    return $460(toCharArray($461));
  };
})();
var afterLastNL4 = function(s) {
  var v = nlIndex4(false)(s);
  if (v instanceof Just) {
    return drop2(v.value0 + 1 | 0)(s);
  }
  ;
  if (v instanceof Nothing) {
    return s;
  }
  ;
  throw new Error("Failed pattern match at RawBars.Lexer (line 257, column 17 - line 259, column 15): " + [v.constructor.name]);
};
var trimStandalone3 = function(seps) {
  return function(toks) {
    var rightBlank = function(i) {
      var goRight = function($copy_k) {
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(k) {
          var v = index(toks)(k);
          if (v instanceof Nothing) {
            $tco_done = true;
            return true;
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent3) {
            if (hasNL4(v.value0.value1)) {
              $tco_done = true;
              return allWs4(beforeFirstNL4(v.value0.value1));
            }
            ;
            if (allWs4(v.value0.value1)) {
              $copy_k = k + 1 | 0;
              return;
            }
            ;
            if (otherwise) {
              $tco_done = true;
              return false;
            }
            ;
          }
          ;
          if (v instanceof Just) {
            $tco_done = true;
            return false;
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 216, column 17 - line 222, column 22): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($copy_k);
        }
        ;
        return $tco_result;
      };
      return goRight(i + 1 | 0);
    };
    var leftBlank = function(i) {
      var goLeft = function($copy_k) {
        var $tco_done1 = false;
        var $tco_result;
        function $tco_loop(k) {
          var v = index(toks)(k);
          if (v instanceof Nothing) {
            $tco_done1 = true;
            return true;
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent3) {
            if (hasNL4(v.value0.value1)) {
              $tco_done1 = true;
              return allWs4(afterLastNL4(v.value0.value1));
            }
            ;
            if (allWs4(v.value0.value1)) {
              $copy_k = k - 1 | 0;
              return;
            }
            ;
            if (otherwise) {
              $tco_done1 = true;
              return false;
            }
            ;
          }
          ;
          if (v instanceof Just) {
            $tco_done1 = true;
            return false;
          }
          ;
          throw new Error("Failed pattern match at RawBars.Lexer (line 204, column 16 - line 210, column 22): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done1) {
          $tco_result = $tco_loop($copy_k);
        }
        ;
        return $tco_result;
      };
      return goLeft(i - 1 | 0);
    };
    var eligible2 = function(t) {
      return blockLevel3(t) || (function() {
        if (t instanceof RSep4) {
          return elem110(sepHead3(t.value2))(seps);
        }
        ;
        return false;
      })();
    };
    var standaloneAt = function(i) {
      var v = index(toks)(i);
      if (v instanceof Just && eligible2(v.value0)) {
        return leftBlank(i) && rightBlank(i);
      }
      ;
      return false;
    };
    var trimContent = function(j) {
      return function(v) {
        if (v instanceof RContent3) {
          var s1 = (function() {
            var $446 = standaloneAt(j - 1 | 0);
            if ($446) {
              return dropLeadingLine4(v.value1);
            }
            ;
            return v.value1;
          })();
          var s2 = (function() {
            var $447 = standaloneAt(j + 1 | 0);
            if ($447) {
              return dropTrailingIndent4(s1);
            }
            ;
            return s1;
          })();
          return new RContent3(v.value0, s2);
        }
        ;
        return v;
      };
    };
    return mapWithIndex2(trimContent)(toks);
  };
};

// output/RawBars.Parser/index.js
var eq7 = /* @__PURE__ */ eq(eqToken);
var eq24 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var fromFoldable23 = /* @__PURE__ */ fromFoldable(foldableList);
var eq37 = /* @__PURE__ */ eq(eqSigil);
var append8 = /* @__PURE__ */ append(semigroupArray);
var identity12 = /* @__PURE__ */ identity(categoryFn);
var StopEOF3 = /* @__PURE__ */ (function() {
  function StopEOF4() {
  }
  ;
  StopEOF4.value = new StopEOF4();
  return StopEOF4;
})();
var StopClose3 = /* @__PURE__ */ (function() {
  function StopClose4(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  StopClose4.create = function(value0) {
    return function(value1) {
      return new StopClose4(value0, value1);
    };
  };
  return StopClose4;
})();
var salvageName3 = function(toks) {
  var v = head(toks);
  if (v instanceof Just && v.value0.tok instanceof TIdent) {
    return new Just(v.value0.tok.value0);
  }
  ;
  return Nothing.value;
};
var partialHead3 = function(toks) {
  var v = uncons(toks);
  if (v instanceof Just && eq7(v.value0.head.tok)(new TOp(">"))) {
    return cons({
      at: v.value0.head.at,
      end: v.value0.head.end,
      tok: new TIdent(">")
    })(v.value0.tail);
  }
  ;
  return toks;
};
var outputExpr3 = function(span2) {
  return function(v) {
    if (v instanceof Left) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Right) {
      if ($$null(v.value0)) {
        return new Left(new EmptyOutput(span2.start));
      }
      ;
      if (otherwise) {
        return parseExpr(v.value0);
      }
      ;
    }
    ;
    throw new Error("Failed pattern match at RawBars.Parser (line 303, column 19 - line 307, column 39): " + [v.constructor.name]);
  };
};
var isSpace8 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var isLetter3 = function(c) {
  return c >= "a" && c <= "z" || c >= "A" && c <= "Z";
};
var isKeyChar3 = function(c) {
  return isLetter3(c) || (c >= "0" && c <= "9" || (c === "_" || c === "-"));
};
var parseDirectives3 = function(base) {
  return function(interior) {
    var cs = toCharArray(interior);
    var len = length(cs);
    var slc = function(a) {
      return function(b) {
        return fromCharArray(slice(a)(b)(cs));
      };
    };
    var at = function(k) {
      return index(cs)(k);
    };
    var isHead = function(k) {
      return eq24(at(k))(new Just("@")) && maybe(false)(isLetter3)(at(k + 1 | 0));
    };
    var valueEnd = function($copy_k) {
      var $tco_done = false;
      var $tco_result;
      function $tco_loop(k) {
        if (k >= len) {
          $tco_done = true;
          return len;
        }
        ;
        if (isHead(k)) {
          $tco_done = true;
          return k;
        }
        ;
        if (otherwise) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        throw new Error("Failed pattern match at RawBars.Parser (line 251, column 3 - line 254, column 35): " + [k.constructor.name]);
      }
      ;
      while (!$tco_done) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var readKey = function($copy_k) {
      var $tco_done1 = false;
      var $tco_result;
      function $tco_loop(k) {
        var $54 = maybe(false)(isKeyChar3)(at(k));
        if ($54) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        $tco_done1 = true;
        return k;
      }
      ;
      while (!$tco_done1) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var skipWs = function($copy_k) {
      var $tco_done2 = false;
      var $tco_result;
      function $tco_loop(k) {
        var $55 = maybe(false)(isSpace8)(at(k));
        if ($55) {
          $copy_k = k + 1 | 0;
          return;
        }
        ;
        $tco_done2 = true;
        return k;
      }
      ;
      while (!$tco_done2) {
        $tco_result = $tco_loop($copy_k);
      }
      ;
      return $tco_result;
    };
    var go = function($copy_j) {
      return function($copy_acc) {
        var $tco_var_j = $copy_j;
        var $tco_done3 = false;
        var $tco_result;
        function $tco_loop(j, acc) {
          if (j >= len) {
            $tco_done3 = true;
            return acc;
          }
          ;
          if (isHead(j)) {
            var keyEnd = readKey(j + 1 | 0);
            var key = slc(j + 1 | 0)(keyEnd);
            var afterKey = skipWs(keyEnd);
            var v = at(afterKey);
            if (v instanceof Just && v.value0 === ":") {
              var vStart = skipWs(afterKey + 1 | 0);
              var vEnd = valueEnd(vStart);
              var dir = {
                key,
                value: trim(slc(vStart)(vEnd)),
                span: {
                  start: base + j | 0,
                  end: base + vEnd | 0
                }
              };
              $tco_var_j = vEnd;
              $copy_acc = snoc(acc)(dir);
              return;
            }
            ;
            var dir = {
              key,
              value: "true",
              span: {
                start: base + j | 0,
                end: base + keyEnd | 0
              }
            };
            $tco_var_j = keyEnd;
            $copy_acc = snoc(acc)(dir);
            return;
          }
          ;
          if (otherwise) {
            $tco_var_j = j + 1 | 0;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at RawBars.Parser (line 256, column 3 - line 256, column 50): " + [j.constructor.name, acc.constructor.name]);
        }
        ;
        while (!$tco_done3) {
          $tco_result = $tco_loop($tco_var_j, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
    return go(0)([]);
  };
};
var isComment3 = function(v) {
  if (v instanceof RComment3) {
    return true;
  }
  ;
  return false;
};
var headedRecovering3 = function(span2) {
  return function(v) {
    if (v instanceof Left) {
      return {
        name: Nothing.value,
        args: [],
        error: new Just(v.value0)
      };
    }
    ;
    if (v instanceof Right) {
      if ($$null(v.value0)) {
        return {
          name: Nothing.value,
          args: [],
          error: new Just(new HeadNotIdent(span2.start))
        };
      }
      ;
      if (otherwise) {
        var v1 = parseExpr(partialHead3(v.value0));
        if (v1 instanceof Right && v1.value0 instanceof App2) {
          return {
            name: new Just(v1.value0.value0),
            args: v1.value0.value1,
            error: Nothing.value
          };
        }
        ;
        if (v1 instanceof Right) {
          return {
            name: Nothing.value,
            args: [],
            error: new Just(new HeadNotIdent(span2.start))
          };
        }
        ;
        if (v1 instanceof Left) {
          return {
            name: salvageName3(partialHead3(v.value0)),
            args: [],
            error: new Just(v1.value0)
          };
        }
        ;
        throw new Error("Failed pattern match at RawBars.Parser (line 360, column 20 - line 363, column 84): " + [v1.constructor.name]);
      }
      ;
    }
    ;
    throw new Error("Failed pattern match at RawBars.Parser (line 356, column 25 - line 363, column 84): " + [v.constructor.name]);
  };
};
var headed3 = function(span2) {
  return function(v) {
    if (v instanceof Left) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Right) {
      if ($$null(v.value0)) {
        return new Left(new HeadNotIdent(span2.start));
      }
      ;
      if (otherwise) {
        var v1 = parseExpr(partialHead3(v.value0));
        if (v1 instanceof Left) {
          return new Left(v1.value0);
        }
        ;
        if (v1 instanceof Right && v1.value0 instanceof App2) {
          return new Right({
            name: v1.value0.value0,
            args: v1.value0.value1
          });
        }
        ;
        if (v1 instanceof Right) {
          return new Left(new HeadNotIdent(span2.start));
        }
        ;
        throw new Error("Failed pattern match at RawBars.Parser (line 319, column 20 - line 322, column 50): " + [v1.constructor.name]);
      }
      ;
    }
    ;
    throw new Error("Failed pattern match at RawBars.Parser (line 315, column 15 - line 322, column 50): " + [v.constructor.name]);
  };
};
var parseSeq3 = function(gates) {
  return function(toks) {
    var done = function(acc) {
      return function(errs) {
        return function(stop) {
          return {
            nodes: fromFoldable23(reverse2(acc)),
            stop,
            errors: errs
          };
        };
      };
    };
    var recover = function(acc) {
      return function(errs) {
        return function(sp) {
          return function(e) {
            return function(next) {
              return go(new Cons(new NodeError(sp, parseErrorMessage(e)), acc))(snoc(errs)(e))(next);
            };
          };
        };
      };
    };
    var go = function($copy_acc) {
      return function($copy_errs) {
        return function($copy_i) {
          var $tco_var_acc = $copy_acc;
          var $tco_var_errs = $copy_errs;
          var $tco_done = false;
          var $tco_result;
          function $tco_loop(acc, errs, i) {
            var v = index(toks)(i);
            if (v instanceof Nothing) {
              $tco_done = true;
              return done(acc)(errs)(StopEOF3.value);
            }
            ;
            if (v instanceof Just) {
              if (v.value0 instanceof RContent3) {
                $tco_var_acc = new Cons(new Content(v.value0.value0, v.value0.value1), acc);
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RComment3) {
                $tco_var_acc = acc;
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RLongComment2) {
                $tco_var_acc = acc;
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RSetDelim2) {
                $tco_var_acc = acc;
                $tco_var_errs = errs;
                $copy_i = i + 1 | 0;
                return;
              }
              ;
              if (v.value0 instanceof RError3) {
                $tco_done = true;
                return recover(acc)(errs)(v.value0.value0)(v.value0.value1)(i + 1 | 0);
              }
              ;
              if (v.value0 instanceof ROutput2) {
                var v1 = outputExpr3(v.value0.value0)(v.value0.value3);
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                if (v1 instanceof Right) {
                  $tco_var_acc = new Cons(new Output(v.value0.value0, v1.value0), acc);
                  $tco_var_errs = errs;
                  $copy_i = i + 1 | 0;
                  return;
                }
                ;
                throw new Error("Failed pattern match at RawBars.Parser (line 438, column 31 - line 440, column 57): " + [v1.constructor.name]);
              }
              ;
              if (v.value0 instanceof RAmp3) {
                if (!gates.extras) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{& }} (unescaped output)", v.value0.value0.start))(i + 1 | 0);
                }
                ;
                if (otherwise) {
                  var v1 = outputExpr3(v.value0.value0)(v.value0.value3);
                  if (v1 instanceof Left) {
                    $tco_done = true;
                    return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                  }
                  ;
                  if (v1 instanceof Right) {
                    $tco_var_acc = new Cons(new Output(v.value0.value0, v1.value0), acc);
                    $tco_var_errs = errs;
                    $copy_i = i + 1 | 0;
                    return;
                  }
                  ;
                  throw new Error("Failed pattern match at RawBars.Parser (line 446, column 24 - line 448, column 61): " + [v1.constructor.name]);
                }
                ;
              }
              ;
              if (v.value0 instanceof RRaw4) {
                if (v.value0.value1 && !gates.rawBlockHash) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{{{# }}}} (raw block)", v.value0.value0.start))(i + 1 | 0);
                }
                ;
                if (!v.value0.value1 && !gates.rawBlockHbs) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{{{ }}}} (raw block)", v.value0.value0.start))(i + 1 | 0);
                }
                ;
                if (otherwise) {
                  var v1 = headed3(v.value0.value0)(v.value0.value4);
                  if (v1 instanceof Left) {
                    $tco_done = true;
                    return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                  }
                  ;
                  if (v1 instanceof Right) {
                    $tco_var_acc = new Cons(new RawBlock(v.value0.value0, v1.value0.name, v1.value0.args, v.value0.value5), acc);
                    $tco_var_errs = errs;
                    $copy_i = i + 1 | 0;
                    return;
                  }
                  ;
                  throw new Error("Failed pattern match at RawBars.Parser (line 459, column 24 - line 461, column 80): " + [v1.constructor.name]);
                }
                ;
              }
              ;
              if (v.value0 instanceof RSep4) {
                var v1 = headed3(v.value0.value0)(v.value0.value3);
                if (v1 instanceof Right) {
                  $tco_var_acc = new Cons(new Sep(v.value0.value0, v1.value0.name, v1.value0.args), acc);
                  $tco_var_errs = errs;
                  $copy_i = i + 1 | 0;
                  return;
                }
                ;
                if (v1 instanceof Left && (v1.value0 instanceof HeadNotIdent && trim(v.value0.value2) !== "")) {
                  var v2 = outputExpr3(v.value0.value0)(v.value0.value3);
                  if (v2 instanceof Left) {
                    $tco_done = true;
                    return recover(acc)(errs)(v.value0.value0)(v2.value0)(i + 1 | 0);
                  }
                  ;
                  if (v2 instanceof Right) {
                    $tco_var_acc = new Cons(new Output(v.value0.value0, v2.value0), acc);
                    $tco_var_errs = errs;
                    $copy_i = i + 1 | 0;
                    return;
                  }
                  ;
                  throw new Error("Failed pattern match at RawBars.Parser (line 473, column 31 - line 475, column 65): " + [v2.constructor.name]);
                }
                ;
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                throw new Error("Failed pattern match at RawBars.Parser (line 466, column 9 - line 476, column 52): " + [v1.constructor.name]);
              }
              ;
              if (v.value0 instanceof RClose3) {
                var v1 = headed3({
                  start: v.value0.value1,
                  end: v.value0.value1
                })(v.value0.value3);
                if (v1 instanceof Left) {
                  $tco_done = true;
                  return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                }
                ;
                if (v1 instanceof Right) {
                  $tco_done = true;
                  return done(acc)(errs)(new StopClose3(v1.value0.name, i + 1 | 0));
                }
                ;
                throw new Error("Failed pattern match at RawBars.Parser (line 477, column 33 - line 481, column 60): " + [v1.constructor.name]);
              }
              ;
              if (v.value0 instanceof ROpen3) {
                if (eq37(v.value0.value1)(Inverse.value) && !gates.extras) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{^ }} (inverse block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq37(v.value0.value1)(Parent.value) && !gates.inheritance) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{< }} (parent block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq37(v.value0.value1)(BlockDef.value) && !gates.inheritance) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{$ }} (override block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq37(v.value0.value1)(Decorator.value) && !gates.decorators) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{#* }} (inline-partial decorator)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (eq37(v.value0.value1)(PartialBlock.value) && !gates.partialBlocks) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(new Just(new DisallowedShape("{{#> }} (partial block)", v.value0.value0.start)))(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
                if (otherwise) {
                  $tco_done = true;
                  return buildBlock(acc)(errs)(Nothing.value)(v.value0.value0)(v.value0.value1)(v.value0.value4)(i + 1 | 0);
                }
                ;
              }
              ;
              throw new Error("Failed pattern match at RawBars.Parser (line 430, column 15 - line 516, column 74): " + [v.value0.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at RawBars.Parser (line 428, column 19 - line 516, column 74): " + [v.constructor.name]);
          }
          ;
          while (!$tco_done) {
            $tco_result = $tco_loop($tco_var_acc, $tco_var_errs, $copy_i);
          }
          ;
          return $tco_result;
        };
      };
    };
    var buildBlock = function(acc) {
      return function(errs) {
        return function(gateErr) {
          return function(span2) {
            return function(sigil) {
              return function(interior) {
                return function(i) {
                  var hr = headedRecovering3(span2)(interior);
                  var errs1 = append8(errs)(catMaybes([gateErr, hr.error]));
                  if (hr.name instanceof Nothing) {
                    return go(new Cons(new NodeError(span2, maybe("parse error")(parseErrorMessage)(hr.error)), acc))(errs1)(i);
                  }
                  ;
                  if (hr.name instanceof Just) {
                    var inner = parseSeq3(gates)(toks)(i);
                    var node2 = new Block(span2, sigil, hr.name.value0, hr.args, inner.nodes);
                    var errs2 = append8(errs1)(inner.errors);
                    if (inner.stop instanceof StopEOF3) {
                      return go(new Cons(node2, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, "<eof>", span2.start)))(length(toks));
                    }
                    ;
                    if (inner.stop instanceof StopClose3) {
                      if (inner.stop.value0 === hr.name.value0) {
                        return go(new Cons(node2, acc))(errs2)(inner.stop.value1);
                      }
                      ;
                      if (otherwise) {
                        return go(new Cons(node2, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, inner.stop.value0, span2.start)))(inner.stop.value1);
                      }
                      ;
                    }
                    ;
                    throw new Error("Failed pattern match at RawBars.Parser (line 546, column 13 - line 556, column 24): " + [inner.stop.constructor.name]);
                  }
                  ;
                  throw new Error("Failed pattern match at RawBars.Parser (line 537, column 7 - line 556, column 24): " + [hr.name.constructor.name]);
                };
              };
            };
          };
        };
      };
    };
    return go(Nil.value)([]);
  };
};
var gatesOf2 = function(opts) {
  return {
    extras: opts.extras,
    inheritance: opts.inheritance,
    decorators: opts.decorators,
    partialBlocks: opts.partialBlocks,
    rawBlockHbs: opts.rawBlockHbs,
    rawBlockHash: opts.rawBlockHash
  };
};
var effectiveTrim3 = function(opts) {
  return function(directives) {
    var v = find2(function(d) {
      return d.key === "trim";
    })(directives);
    if (v instanceof Nothing) {
      return new Right(opts.trimStandalone);
    }
    ;
    if (v instanceof Just) {
      if (v.value0.value === "standalone") {
        return new Right(true);
      }
      ;
      if (v.value0.value === "none") {
        return new Right(false);
      }
      ;
      return new Left(new BadDirective("invalid @trim value '" + (v.value0.value + "'; expected 'standalone' or 'none'"), v.value0.span.start));
    }
    ;
    throw new Error("Failed pattern match at RawBars.Parser (line 198, column 33 - line 206, column 8): " + [v.constructor.name]);
  };
};
var defaultParseOptions2 = {
  trimStandalone: true,
  extras: true,
  inheritance: false,
  decorators: true,
  partialBlocks: true,
  rawBlockHbs: true,
  rawBlockHash: false,
  standaloneSeps: ["else", "elif"],
  lexConfig: defaultLexConfig3
};
var rawOptions = /* @__PURE__ */ (function() {
  return {
    trimStandalone: defaultParseOptions2.trimStandalone,
    inheritance: defaultParseOptions2.inheritance,
    extras: false,
    decorators: false,
    partialBlocks: false,
    rawBlockHbs: false,
    rawBlockHash: true,
    standaloneSeps: ["else", "elif", "when"],
    lexConfig: rawLexConfig(false)
  };
})();
var collectDirectives3 = function(toks) {
  var go = function($copy_i) {
    return function($copy_headerOpen) {
      return function($copy_acc) {
        var $tco_var_i = $copy_i;
        var $tco_var_headerOpen = $copy_headerOpen;
        var $tco_done = false;
        var $tco_result;
        function $tco_loop(i, headerOpen, acc) {
          var v = index(toks)(i);
          if (v instanceof Nothing) {
            $tco_done = true;
            return new Right(acc);
          }
          ;
          if (v instanceof Just && v.value0 instanceof RComment3) {
            var dirs = parseDirectives3(v.value0.value1)(v.value0.value2);
            if (headerOpen) {
              $tco_var_i = i + 1 | 0;
              $tco_var_headerOpen = true;
              $copy_acc = append8(acc)(dirs);
              return;
            }
            ;
            var v1 = head(dirs);
            if (v1 instanceof Just) {
              $tco_done = true;
              return new Left(new DirectiveAfterHeader(v1.value0.span.start));
            }
            ;
            if (v1 instanceof Nothing) {
              $tco_var_i = i + 1 | 0;
              $tco_var_headerOpen = false;
              $copy_acc = acc;
              return;
            }
            ;
            throw new Error("Failed pattern match at RawBars.Parser (line 229, column 14 - line 231, column 42): " + [v1.constructor.name]);
          }
          ;
          if (v instanceof Just && v.value0 instanceof RContent3) {
            $tco_var_i = i + 1 | 0;
            $tco_var_headerOpen = headerOpen;
            $copy_acc = acc;
            return;
          }
          ;
          if (v instanceof Just) {
            $tco_var_i = i + 1 | 0;
            $tco_var_headerOpen = false;
            $copy_acc = acc;
            return;
          }
          ;
          throw new Error("Failed pattern match at RawBars.Parser (line 222, column 25 - line 233, column 35): " + [v.constructor.name]);
        }
        ;
        while (!$tco_done) {
          $tco_result = $tco_loop($tco_var_i, $tco_var_headerOpen, $copy_acc);
        }
        ;
        return $tco_result;
      };
    };
  };
  return go(0)(true)([]);
};
var parseRecoveringWith = function(opts) {
  return function(src) {
    var runSeq = function($copy_toks) {
      return function($copy_idx) {
        return function($copy_accNodes) {
          return function($copy_accErrs) {
            var $tco_var_toks = $copy_toks;
            var $tco_var_idx = $copy_idx;
            var $tco_var_accNodes = $copy_accNodes;
            var $tco_done = false;
            var $tco_result;
            function $tco_loop(toks, idx, accNodes, accErrs) {
              var r = parseSeq3(gatesOf2(opts))(toks)(idx);
              var nodes$prime = append8(accNodes)(r.nodes);
              var errs$prime = append8(accErrs)(r.errors);
              if (r.stop instanceof StopEOF3) {
                $tco_done = true;
                return {
                  nodes: nodes$prime,
                  errors: errs$prime
                };
              }
              ;
              if (r.stop instanceof StopClose3) {
                $tco_var_toks = toks;
                $tco_var_idx = r.stop.value1;
                $tco_var_accNodes = nodes$prime;
                $copy_accErrs = snoc(errs$prime)(new MismatchedBlock("<none>", r.stop.value0, 0));
                return;
              }
              ;
              throw new Error("Failed pattern match at RawBars.Parser (line 166, column 7 - line 169, column 63): " + [r.stop.constructor.name]);
            }
            ;
            while (!$tco_done) {
              $tco_result = $tco_loop($tco_var_toks, $tco_var_idx, $tco_var_accNodes, $copy_accErrs);
            }
            ;
            return $tco_result;
          };
        };
      };
    };
    var v = tokenizeTemplate3(opts.lexConfig)(src);
    if (v instanceof Left) {
      return {
        directives: [],
        nodes: [],
        errors: [v.value0]
      };
    }
    ;
    if (v instanceof Right) {
      var dirRes = collectDirectives3(v.value0);
      var directives = either($$const([]))(identity12)(dirRes);
      var trimRes = effectiveTrim3(opts)(directives);
      var standalone = either($$const(false))(identity12)(trimRes);
      var toks$prime = (function() {
        if (standalone) {
          return trimStandalone3(opts.standaloneSeps)(v.value0);
        }
        ;
        return v.value0;
      })();
      var filtered = filter(function($170) {
        return !isComment3($170);
      })(toks$prime);
      var seq = runSeq(filtered)(0)([])([]);
      var trimErrs = either(singleton2)($$const([]))(trimRes);
      var dirErrs = either(singleton2)($$const([]))(dirRes);
      return {
        directives,
        nodes: seq.nodes,
        errors: append8(dirErrs)(append8(trimErrs)(seq.errors))
      };
    }
    ;
    throw new Error("Failed pattern match at RawBars.Parser (line 131, column 32 - line 150, column 82): " + [v.constructor.name]);
  };
};
var parseRecovering3 = /* @__PURE__ */ parseRecoveringWith(rawOptions);
var parseWith2 = function(opts) {
  return function(src) {
    var r = parseRecoveringWith(opts)(src);
    var v = fromArray(r.errors);
    if (v instanceof Just) {
      return new Left(v.value0);
    }
    ;
    if (v instanceof Nothing) {
      return new Right({
        directives: r.directives,
        nodes: r.nodes
      });
    }
    ;
    throw new Error("Failed pattern match at RawBars.Parser (line 183, column 5 - line 185, column 68): " + [v.constructor.name]);
  };
};
var parse3 = /* @__PURE__ */ parseWith2(rawOptions);

// output/RawBars/index.js
var runResolved2 = /* @__PURE__ */ runResolved(monadThrowEither);
var toUnfoldable11 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var map35 = /* @__PURE__ */ map(functorEither);
var lmap6 = /* @__PURE__ */ lmap(bifunctorEither);
var traverse15 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var union12 = /* @__PURE__ */ union(ordString);
var map114 = /* @__PURE__ */ map(functorMap);
var fromFoldable24 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var map210 = /* @__PURE__ */ map(functorArray);
var emitJs = function(v) {
  var h = hoistInline(v.nodes);
  return compile(metaFor("rt.truthyNonEmpty")("yield"))(coreEmit)(toUnfoldable11(h.partials))(h.template);
};
var checkCore = function(stmtTags) {
  return function(src) {
    var firstViolation = function(nodes) {
      if (stmtTags) {
        var v = braceControlViolation(["else", "elif", "when"])(src)(nodes);
        if (v instanceof Just) {
          return new Just(v.value0);
        }
        ;
        if (v instanceof Nothing) {
          var v1 = reservedBindingViolation(blockHelperNames)(nodes);
          if (v1 instanceof Just) {
            return new Just(v1.value0);
          }
          ;
          if (v1 instanceof Nothing) {
            return caseLeadingViolation(nodes);
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 91, column 22 - line 93, column 50): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 89, column 9 - line 93, column 50): " + [v.constructor.name]);
      }
      ;
      if (otherwise) {
        return caseLeadingViolation(nodes);
      }
      ;
      throw new Error("Failed pattern match at RawBars (line 87, column 3 - line 94, column 45): " + [nodes.constructor.name]);
    };
    return function(v) {
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        var v1 = firstViolation(v.value0.nodes);
        if (v1 instanceof Just) {
          return new Left(singleton6(new DisallowedShape(v1.value0.shape, v1.value0.off)));
        }
        ;
        if (v1 instanceof Nothing) {
          return new Right((function() {
            if (stmtTags) {
              return {
                directives: v.value0.directives,
                nodes: liftSet(v.value0.nodes)
              };
            }
            ;
            return v.value0;
          })());
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 83, column 14 - line 85, column 77): " + [v1.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at RawBars (line 81, column 26 - line 85, column 77): " + [v.constructor.name]);
    };
  };
};
var parseRaw = function(src) {
  return checkCore(true)(src)(parse3(src));
};
var compileJs = function(src) {
  return map35(emitJs)(lmap6(head2)(parseRaw(src)));
};
var inspectWith = function(target) {
  return function(partialSrcs) {
    return function(src) {
      return function(dat) {
        var compilePartial = function(v2) {
          var v12 = parseRaw(v2.value1);
          if (v12 instanceof Left) {
            return new Left(renderParseErrorsAt(v2.value1)(v12.value0));
          }
          ;
          if (v12 instanceof Right) {
            return new Right({
              name: v2.value0,
              template: v12.value0.nodes
            });
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 269, column 35 - line 271, column 55): " + [v12.constructor.name]);
        };
        var v = traverse15(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          var v1 = parseRaw(src);
          if (v1 instanceof Left) {
            return new Left(renderParseErrorsAt(src)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            var h = hoistInline(v1.value0.nodes);
            var partialFiles = union12(map114($$const("main"))(h.partials))(fromFoldable24(map210(function(p) {
              return new Tuple(p.name, p.name);
            })(v.value0)));
            var externalT = fromFoldable24(map210(function(p) {
              return new Tuple(p.name, p.template);
            })(v.value0));
            var setup = (function() {
              var $120 = registerPartialFiles(partialFiles);
              var $121 = withTruthy(nonEmpty);
              var $122 = withYieldName("yield");
              var $123 = registerPartials(union12(h.partials)(externalT));
              return function($124) {
                return $120($121($122($123($124))));
              };
            })();
            return lmap6(formatError(src))(inspectResolvedStrict(setup)(target)(h.template)(dat));
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 253, column 17 - line 267, column 85): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 251, column 3 - line 267, column 85): " + [v.constructor.name]);
      };
    };
  };
};
var renderDiag = function(src) {
  return function(dat) {
    var v = parseRaw(src);
    if (v instanceof Left) {
      return new Left(renderParseErrorsAt(src)(v.value0));
    }
    ;
    if (v instanceof Right) {
      var h = hoistInline(v.value0.nodes);
      return lmap6(formatError(src))(runResolved2(v.value0.directives)((function() {
        var $133 = withTruthy(nonEmpty);
        var $134 = withYieldName("yield");
        var $135 = registerPartials(h.partials);
        return function($136) {
          return $133($134($135($136)));
        };
      })())(h.template)(dat));
    }
    ;
    throw new Error("Failed pattern match at RawBars (line 150, column 22 - line 161, column 10): " + [v.constructor.name]);
  };
};
var renderMappedWith = function(partialSrcs) {
  return function(src) {
    return function(dat) {
      var compilePartial = function(v2) {
        var v12 = parseRaw(v2.value1);
        if (v12 instanceof Left) {
          return new Left(renderParseErrorsAt(v2.value1)(v12.value0));
        }
        ;
        if (v12 instanceof Right) {
          return new Right({
            name: v2.value0,
            template: v12.value0.nodes
          });
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 234, column 35 - line 236, column 55): " + [v12.constructor.name]);
      };
      var v = traverse15(compilePartial)(partialSrcs);
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        var v1 = parseRaw(src);
        if (v1 instanceof Left) {
          return new Left(renderParseErrorsAt(src)(v1.value0));
        }
        ;
        if (v1 instanceof Right) {
          var h = hoistInline(v1.value0.nodes);
          var partialFiles = union12(map114($$const("main"))(h.partials))(fromFoldable24(map210(function(p) {
            return new Tuple(p.name, p.name);
          })(v.value0)));
          var externalT = fromFoldable24(map210(function(p) {
            return new Tuple(p.name, p.template);
          })(v.value0));
          var setup = (function() {
            var $139 = registerPartialFiles(partialFiles);
            var $140 = withTruthy(nonEmpty);
            var $141 = withYieldName("yield");
            var $142 = registerPartials(union12(h.partials)(externalT));
            return function($143) {
              return $139($140($141($142($143))));
            };
          })();
          return lmap6(formatError(src))(runResolvedMapped(setup)(h.template)(dat));
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 217, column 17 - line 232, column 74): " + [v1.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at RawBars (line 215, column 3 - line 232, column 74): " + [v.constructor.name]);
    };
  };
};
var renderMapped = /* @__PURE__ */ renderMappedWith([]);
var renderWithOperations2 = function(operations) {
  return function(partialSrcs) {
    return function(src) {
      return function(dat) {
        var compilePartial = function(v2) {
          var v12 = parseRaw(v2.value1);
          if (v12 instanceof Left) {
            return new Left(renderParseErrorsAt(v2.value1)(v12.value0));
          }
          ;
          if (v12 instanceof Right) {
            return new Right({
              name: v2.value0,
              template: v12.value0.nodes
            });
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 198, column 35 - line 200, column 55): " + [v12.constructor.name]);
        };
        var v = traverse15(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          var v1 = parseRaw(src);
          if (v1 instanceof Left) {
            return new Left(renderParseErrorsAt(src)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            var h = hoistInline(v1.value0.nodes);
            var externalT = fromFoldable24(map210(function(p) {
              return new Tuple(p.name, p.template);
            })(v.value0));
            var setup = (function() {
              var $144 = withTruthy(nonEmpty);
              var $145 = withYieldName("yield");
              var $146 = registerAll(operations);
              var $147 = registerPartials(union12(h.partials)(externalT));
              return function($148) {
                return $144($145($146($147($148))));
              };
            })();
            return lmap6(formatError(src))(runResolved2(v1.value0.directives)(setup)(h.template)(dat));
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 182, column 17 - line 196, column 79): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 180, column 3 - line 196, column 79): " + [v.constructor.name]);
      };
    };
  };
};

// output/RawBars.Highlight/index.js
var eq110 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var append9 = /* @__PURE__ */ append(semigroupArray);
var elem22 = /* @__PURE__ */ elem2(eqString);
var rawClauseSeps = ["else", "elif", "when"];
var isSpace9 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var trimmedChars3 = /* @__PURE__ */ (function() {
  var $61 = dropWhile(isSpace9);
  return function($62) {
    return $61(toCharArray($62));
  };
})();
var isPartialHead3 = function(s) {
  return eq110(head(trimmedChars3(s)))(new Just(">"));
};
var headWord3 = function(s) {
  return fromCharArray(takeWhile(function($63) {
    return !isSpace9($63);
  })(trimmedChars3(s)));
};
var tokenizeSpans3 = function(src) {
  var tag = function(sp) {
    return function(kind) {
      return [{
        from: sp.start,
        to: sp.end,
        kind,
        role: "tag"
      }];
    };
  };
  var carve = function(pt) {
    return function(kind) {
      return {
        from: pt.at,
        to: pt.end,
        kind,
        role: "interior"
      };
    };
  };
  var interiorSpan = function(pt) {
    if (pt.tok instanceof TStr) {
      return new Just(carve(pt)("string"));
    }
    ;
    if (pt.tok instanceof TNum) {
      return new Just(carve(pt)("number"));
    }
    ;
    if (pt.tok instanceof TOp) {
      return new Just(carve(pt)("operator"));
    }
    ;
    return Nothing.value;
  };
  var carveInterior = function(v2) {
    if (v2 instanceof Left) {
      return [];
    }
    ;
    if (v2 instanceof Right) {
      return mapMaybe(interiorSpan)(v2.value0);
    }
    ;
    throw new Error("Failed pattern match at RawBars.Highlight (line 78, column 19 - line 80, column 51): " + [v2.constructor.name]);
  };
  var openSpans = function(sp) {
    return function(sig) {
      return function($$int2) {
        if (sig instanceof Section) {
          return append9(tag(sp)("block-open"))(carveInterior($$int2));
        }
        ;
        if (sig instanceof PartialBlock) {
          return append9(tag(sp)("block-open"))(carveInterior($$int2));
        }
        ;
        if (sig instanceof Decorator) {
          return append9(tag(sp)("block-open"))(carveInterior($$int2));
        }
        ;
        if (sig instanceof Inverse) {
          return tag(sp)("error");
        }
        ;
        if (sig instanceof Parent) {
          return tag(sp)("error");
        }
        ;
        if (sig instanceof BlockDef) {
          return tag(sp)("error");
        }
        ;
        throw new Error("Failed pattern match at RawBars.Highlight (line 69, column 26 - line 75, column 31): " + [sig.constructor.name]);
      };
    };
  };
  var spansOf = function(v2) {
    if (v2 instanceof RContent3) {
      return [];
    }
    ;
    if (v2 instanceof ROutput2) {
      return append9(tag(v2.value0)("raw"))(carveInterior(v2.value3));
    }
    ;
    if (v2 instanceof RAmp3) {
      return tag(v2.value0)("error");
    }
    ;
    if (v2 instanceof ROpen3) {
      return openSpans(v2.value0)(v2.value1)(v2.value4);
    }
    ;
    if (v2 instanceof RClose3) {
      return append9(tag(v2.value0)("block-close"))(carveInterior(v2.value3));
    }
    ;
    if (v2 instanceof RSep4) {
      if (isPartialHead3(v2.value2)) {
        return tag(v2.value0)("partial");
      }
      ;
      if (elem22(headWord3(v2.value2))(rawClauseSeps)) {
        return append9(tag(v2.value0)("keyword"))(carveInterior(v2.value3));
      }
      ;
      if (headWord3(v2.value2) === "set") {
        return append9(tag(v2.value0)("keyword"))(carveInterior(v2.value3));
      }
      ;
      if (otherwise) {
        return append9(tag(v2.value0)("expr"))(carveInterior(v2.value3));
      }
      ;
    }
    ;
    if (v2 instanceof RRaw4) {
      if (v2.value1) {
        return tag(v2.value0)("raw-block");
      }
      ;
      if (otherwise) {
        return tag(v2.value0)("error");
      }
      ;
    }
    ;
    if (v2 instanceof RComment3) {
      return tag(v2.value0)("comment");
    }
    ;
    if (v2 instanceof RLongComment2) {
      return tag(v2.value0)("comment");
    }
    ;
    if (v2 instanceof RSetDelim2) {
      return tag(v2.value0)("set-delimiter");
    }
    ;
    if (v2 instanceof RError3) {
      return tag(v2.value0)("unterminated");
    }
    ;
    throw new Error("Failed pattern match at RawBars.Highlight (line 43, column 13 - line 63, column 41): " + [v2.constructor.name]);
  };
  var v = tokenizeTemplate3(rawLexConfig(true))(src);
  if (v instanceof Left) {
    return [];
  }
  ;
  if (v instanceof Right) {
    return concatMap(spansOf)(v.value0);
  }
  ;
  throw new Error("Failed pattern match at RawBars.Highlight (line 38, column 21 - line 40, column 45): " + [v.constructor.name]);
};
var highlightSpans3 = function(src) {
  var tagOnly = function(s) {
    if (s.role === "tag") {
      return new Just({
        from: s.from,
        to: s.to,
        kind: s.kind
      });
    }
    ;
    if (otherwise) {
      return Nothing.value;
    }
    ;
    throw new Error("Failed pattern match at RawBars.Highlight (line 99, column 3 - line 99, column 34): " + [s.constructor.name]);
  };
  return mapMaybe(tagOnly)(tokenizeSpans3(src));
};

// output/ClassicBars.JS/index.js
var $runtime_lazy9 = function(name2, moduleName, init2) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init2();
    state2 = 2;
    return val;
  };
};
var map36 = /* @__PURE__ */ map(functorArray);
var fromFoldable25 = /* @__PURE__ */ fromFoldable11(foldableArray);
var append10 = /* @__PURE__ */ append(semigroupArray);
var show18 = /* @__PURE__ */ show(showNumber);
var toUnfoldable13 = /* @__PURE__ */ toUnfoldable8(unfoldableArray);
var pure18 = /* @__PURE__ */ pure(applicativeEither);
var identity13 = /* @__PURE__ */ identity(categoryFn);
var throwError2 = /* @__PURE__ */ throwError(monadThrowEither);
var fromFoldable110 = /* @__PURE__ */ fromFoldable2(ordString)(foldableArray);
var constOperation2 = /* @__PURE__ */ constOperation(applicativeEither);
var union13 = /* @__PURE__ */ union(ordString);
var show19 = /* @__PURE__ */ show(showError);
var elem23 = /* @__PURE__ */ elem2(eqString);
var toTranslator = function(jt) {
  return function(name2) {
    return function(args) {
      var r = callJsTranslatorImpl(jt)(name2)(map36(toJson)(args));
      if (r.hit) {
        return new Just(r.value);
      }
      ;
      return Nothing.value;
    };
  };
};
var toPathSchema = function(schema) {
  return function(p) {
    return function(v) {
      return callJsPathSchemaImpl(schema)(p)(toJson(v));
    };
  };
};
var str = id;
var tt2 = function(t) {
  return new Tuple("t", str(t));
};
var sevText = /* @__PURE__ */ show(showSeverity);
var segmentSnapshot = function(s) {
  var optField = function(name2) {
    return maybe([])(function(v) {
      return [new Tuple(name2, toJson(v))];
    });
  };
  return id(fromFoldable25(append10([new Tuple("this", toJson(s["this"]))])(append10(optField("parent")(s.parent))(append10(optField("root")(s.root))(append10(optField("index")(s.index))(append10(optField("index1")(s.index1))(append10(optField("key")(s.key))(append10(optField("first")(s.first))(append10(optField("last")(s.last))([new Tuple("locals", id(fromFoldable25(map36(function(v) {
    return new Tuple(v.value0, toJson(v.value1));
  })(s.locals))))]))))))))));
};
var segmentJson = function(s) {
  return id(fromFoldable25([new Tuple("out", id(toNumber(s.out))), new Tuple("len", id(toNumber(s.len))), new Tuple("kind", id(s.kind)), new Tuple("file", id(s.file)), new Tuple("start", maybe(jsonNull)(function($182) {
    return id(toNumber($182));
  })(s.start)), new Tuple("end", maybe(jsonNull)(function($183) {
    return id(toNumber($183));
  })(s.end))]));
};
var segment = function(v) {
  if (v instanceof Lit && v.value0 instanceof VString) {
    return str(v.value0.value0);
  }
  ;
  if (v instanceof Lit && v.value0 instanceof VNumber) {
    return str(show18(v.value0.value0));
  }
  ;
  if (v instanceof App2) {
    return str(v.value0);
  }
  ;
  return str("?");
};
var rlit = function(v) {
  if (v instanceof VString) {
    return str(v.value0);
  }
  ;
  if (v instanceof VSafe) {
    return str(v.value0);
  }
  ;
  if (v instanceof VNumber) {
    return id(v.value0);
  }
  ;
  if (v instanceof VBool) {
    return id(v.value0);
  }
  ;
  if (v instanceof VNull) {
    return jsonNull;
  }
  ;
  return jsonNull;
};
var result = /* @__PURE__ */ either(function(e) {
  return {
    ok: false,
    value: "",
    error: e
  };
})(function(v) {
  return {
    ok: true,
    value: v,
    error: ""
  };
});
var renderSurfaceWithPartials = function(partials, tpl, json) {
  return result(renderSurfaceWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderSurfaceI18n2 = function(jt, tpl, json) {
  return result(renderSurfaceI18n(toTranslator(jt))(tpl)(fromJson(json)));
};
var renderSurface = function(tpl, json) {
  return result(renderSurfaceDiag(tpl)(fromJson(json)));
};
var renderMustache = function(partials, tpl, json) {
  return result(renderMinWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderMinbarsCompatWithPartials = function(partials, tpl, json) {
  return result(renderMinCompatWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderMinbarsCompat = function(tpl, json) {
  return result(renderMinCompat(tpl)(fromJson(json)));
};
var renderMinbars = function(tpl, json) {
  return result(renderMinDiag(tpl)(fromJson(json)));
};
var renderMaxbarsWithPartials = function(partials, tpl, json) {
  return result(renderMaxWithPartials(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderMaxbars = function(tpl, json) {
  return result(renderMax(tpl)(fromJson(json)));
};
var render = function(tpl, json) {
  return result(renderDiag(tpl)(fromJson(json)));
};
var obj = function(kvs) {
  return id(fromFoldable25(kvs));
};
var migrate = function(tpl) {
  var v = migrateToMaxBars(tpl);
  if (v instanceof Left) {
    return {
      ok: false,
      source: "",
      residuals: [],
      error: renderParseErrorAt(tpl)(v.value0)
    };
  }
  ;
  if (v instanceof Right) {
    return {
      ok: true,
      source: v.value0.source,
      residuals: map36(function(x) {
        return {
          kind: x.kind,
          message: x.message,
          suggestion: x.suggestion
        };
      })(v.value0.residuals),
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.JS (line 271, column 25 - line 279, column 6): " + [v.constructor.name]);
};
var mappedResult = /* @__PURE__ */ either(function(e) {
  return {
    ok: false,
    output: "",
    segments: [],
    error: e
  };
})(function(r) {
  return {
    ok: true,
    output: r.output,
    segments: map36(segmentJson)(r.segments),
    error: ""
  };
});
var renderMapped2 = function(tpl, json) {
  return mappedResult(renderMapped(tpl)(fromJson(json)));
};
var renderMappedWithPartials = function(partials, tpl, json) {
  return mappedResult(renderMappedWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderMaxbarsMapped = function(tpl, json) {
  return mappedResult(renderMaxMapped(tpl)(fromJson(json)));
};
var renderMaxbarsMappedWithPartials = function(partials, tpl, json) {
  return mappedResult(renderMaxMappedWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderMinbarsMapped = function(tpl, json) {
  return mappedResult(renderMinMapped(tpl)(fromJson(json)));
};
var renderMinbarsMappedCompat = function(tpl, json) {
  return mappedResult(renderMinMappedCompat(tpl)(fromJson(json)));
};
var renderMinbarsMappedCompatWithPartials = function(partials, tpl, json) {
  return mappedResult(renderMinMappedCompatWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderMinbarsMappedWithPartials = function(partials, tpl, json) {
  return mappedResult(renderMinMappedWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderSurfaceMapped2 = function(tpl, json) {
  return mappedResult(renderSurfaceMapped(tpl)(fromJson(json)));
};
var renderSurfaceMappedWithPartials = function(partials, tpl, json) {
  return mappedResult(renderSurfaceMappedWith(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var litName2 = function(args) {
  var v = head(args);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return new Just(v.value0.value0.value0);
  }
  ;
  return Nothing.value;
};
var partialName3 = function(v) {
  if (v instanceof App2 && v.value0 === "partial") {
    return litName2(v.value1);
  }
  ;
  return Nothing.value;
};
var lint = function(tpl, dialect) {
  var surface = dialect === "classicbars";
  var parseDialect = (function() {
    if (dialect === "maxbars") {
      return parse2;
    }
    ;
    if (dialect === "classicbars") {
      return parseWith(defaultParseOptions);
    }
    ;
    return parse3;
  })();
  var v = parseDialect(tpl);
  if (v instanceof Left) {
    return {
      ok: false,
      findings: [],
      report: "",
      error: renderParseErrorsAt(tpl)(v.value0)
    };
  }
  ;
  if (v instanceof Right) {
    var locate = function(i) {
      return lineColumn(tpl)(i.span.start + fromMaybe(0)(indexOf2(i.name)(spanText(tpl)(i.span))) | 0);
    };
    var issues = append10(aliasWarnings(v.value0.nodes))((function() {
      if (surface) {
        return [];
      }
      ;
      return scopedCanonWarnings(v.value0.nodes);
    })());
    var fmt = function(i) {
      return sevText(i.severity) + (": " + i.message);
    };
    return {
      ok: true,
      findings: map36(function(i) {
        var lc = locate(i);
        return {
          severity: sevText(i.severity),
          name: i.name,
          message: i.message,
          line: lc.line,
          column: lc.column
        };
      })(issues),
      report: (function() {
        var $76 = $$null(issues);
        if ($76) {
          return "ok: no lint findings";
        }
        ;
        return joinWith("\n")(map36(fmt)(issues));
      })(),
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.JS (line 221, column 5 - line 253, column 12): " + [v.constructor.name]);
};
var jsOperation = function(name2) {
  return function(fn) {
    return function(ctl) {
      return function(args) {
        var $79 = $$null(ctl.children);
        if ($79) {
          var v = callJsHelperImpl(name2)(fn)(map36(toJson)(args));
          if (v.tag === "safe") {
            return pure18(new VSafe(caseJsonString("")(identity13)(v.payload)));
          }
          ;
          if (v.tag === "arity") {
            return throwError2(new ArityError(caseJsonString("")(identity13)(v.payload)));
          }
          ;
          if (v.tag === "error") {
            return throwError2(new HelperError(caseJsonString("")(identity13)(v.payload)));
          }
          ;
          if (otherwise) {
            return pure18(fromJson(v.payload));
          }
          ;
          throw new Error("Failed pattern match at ClassicBars.JS (line 600, column 35 - line 605, column 47): " + [v.constructor.name]);
        }
        ;
        var optsFrame = function(optsJson) {
          var o = caseJsonObject(empty4)(identity13)(optsJson);
          var dataObj = caseJsonObject(empty4)(identity13)(fromMaybe(jsonNull)(lookup8("data")(o)));
          var dataMap = fromFoldable110(map36(function(v2) {
            return new Tuple(v2.value0, constOperation2(fromJson(v2.value1)));
          })(toUnfoldable13(dataObj)));
          var bpVals = caseJsonArray([])(identity13)(fromMaybe(jsonNull)(lookup8("blockParams")(o)));
          var bpMap = fromFoldable110(zipWith(function(n) {
            return function(v2) {
              return new Tuple(n, constOperation2(fromJson(v2)));
            };
          })(ctl.blockParams)(bpVals));
          return union13(bpMap)(dataMap);
        };
        var renderClause = function(nodes) {
          return function(ctxJson) {
            return function(optsJson) {
              var v2 = ctl.render(pushFrame(optsFrame(optsJson))(fromJson(ctxJson))(ctl.env))(nodes);
              if (v2 instanceof Right) {
                return {
                  ok: true,
                  value: v2.value0,
                  error: ""
                };
              }
              ;
              if (v2 instanceof Left) {
                return {
                  ok: false,
                  value: "",
                  error: show19(v2.value0)
                };
              }
              ;
              throw new Error("Failed pattern match at ClassicBars.JS (line 631, column 9 - line 633, column 60): " + [v2.constructor.name]);
            };
          };
        };
        var nDrop = length(ctl.blockParams) + (function() {
          var $87 = isJust(ctl.hash);
          if ($87) {
            return 1;
          }
          ;
          return 0;
        })() | 0;
        var forwardArgs = take(length(args) - nDrop | 0)(args);
        var clause = ctl.clause("else");
        var r = callJsBlockHelperImpl(name2)(fn)(map36(toJson)(forwardArgs))(toJson(refContext(ctl.env)))(maybe(jsonNull)(toJson)(ctl.hash))(renderClause(clause.before))(renderClause(fromMaybe([])(clause.body)));
        if (r.tag === "arity") {
          return throwError2(new ArityError(caseJsonString("")(identity13)(r.payload)));
        }
        ;
        if (r.tag === "error") {
          return throwError2(new HelperError(caseJsonString("")(identity13)(r.payload)));
        }
        ;
        return pure18(new VSafe(caseJsonString("")(identity13)(r.payload)));
      };
    };
  };
};
var marshalOps = /* @__PURE__ */ (function() {
  var $184 = map36(function(v) {
    return new Tuple(v.value0, jsOperation(v.value0)(v.value1));
  });
  return function($185) {
    return $184(toUnfoldable13($185));
  };
})();
var renderMaxWith = function(operations, partials, tpl, json) {
  return result(renderWithOperations(marshalOps(operations))(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderRawWith = function(operations, partials, tpl, json) {
  return result(renderWithOperations2(marshalOps(operations))(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var renderWith = function(helpers, partials, tpl, json) {
  return result(renderSurfaceWithHelpers(marshalOps(helpers))(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var $$int = function(n) {
  return id(toNumber(n));
};
var srcOf = function(sp) {
  return new Tuple("src", obj([new Tuple("start", $$int(sp.start)), new Tuple("end", $$int(sp.end))]));
};
var inspectResult = function(v) {
  if (v instanceof Left) {
    return {
      ok: false,
      snapshots: [],
      error: v.value0
    };
  }
  ;
  if (v instanceof Right) {
    return {
      ok: true,
      snapshots: map36(segmentSnapshot)(v.value0),
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.JS (line 436, column 17 - line 438, column 79): " + [v.constructor.name]);
};
var inspectSurface = function(partials, target, tpl, json) {
  return inspectResult(inspectSurfaceWith(target)(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var inspectMinbarsCompat = function(partials, target, tpl, json) {
  return inspectResult(inspectMinCompatWith(toUnfoldable13(partials))(target)(tpl)(fromJson(json)));
};
var inspectMinbars = function(partials, target, tpl, json) {
  return inspectResult(inspectMinWith(toUnfoldable13(partials))(target)(tpl)(fromJson(json)));
};
var inspectMaxbars = function(partials, target, tpl, json) {
  return inspectResult(inspectMaxWith(target)(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var inspect = function(partials, target, tpl, json) {
  return inspectResult(inspectWith(target)(toUnfoldable13(partials))(tpl)(fromJson(json)));
};
var inferOut = function(v) {
  if (v instanceof Left) {
    return {
      ok: false,
      schema: "",
      dataScaffold: "",
      report: "",
      conflicts: 0,
      error: v.value0
    };
  }
  ;
  if (v instanceof Right) {
    return {
      ok: true,
      schema: v.value0.schema,
      dataScaffold: v.value0.dataScaffold,
      report: v.value0.report,
      conflicts: v.value0.conflicts,
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.JS (line 309, column 12 - line 318, column 6): " + [v.constructor.name]);
};
var inferMaxbarsData = function(tpl, json) {
  return inferOut(inferMaxData([fromJson(json)])(tpl));
};
var inferMaxbars = function(tpl) {
  return inferOut(inferMax(tpl));
};
var highlightConfig = /* @__PURE__ */ (function() {
  var withSetDelims = {
    close: defaultLexConfig.close,
    open: defaultLexConfig.open,
    mustacheDelims: true,
    keepLongComments: true
  };
  var kernelClauses = ["else", "elif"];
  return function(v) {
    if (v === "minbars") {
      return {
        lexConfig: withSetDelims,
        clauseSeps: [],
        extras: true,
        inheritance: true,
        rawBlockHbs: false,
        rawBlockHash: false
      };
    }
    ;
    return {
      lexConfig: {
        open: defaultLexConfig.open,
        close: defaultLexConfig.close,
        mustacheDelims: defaultLexConfig.mustacheDelims,
        keepLongComments: true
      },
      clauseSeps: kernelClauses,
      extras: true,
      inheritance: false,
      rawBlockHbs: true,
      rawBlockHash: false
    };
  };
})();
var highlightSpans4 = function(tpl, dialect) {
  if (dialect === "maxbars") {
    return highlightSpans2(tpl);
  }
  ;
  if (dialect === "rawbars") {
    return highlightSpans3(tpl);
  }
  ;
  return highlightSpans(highlightConfig(dialect))(tpl);
};
var tokenize2 = function(tpl, dialect) {
  if (dialect === "maxbars") {
    return tokenizeSpans2(tpl);
  }
  ;
  if (dialect === "rawbars") {
    return tokenizeSpans3(tpl);
  }
  ;
  return tokenizeSpans(highlightConfig(dialect))(tpl);
};
var diagnostics = function(src, dialect) {
  var recover = (function() {
    if (dialect === "maxbars") {
      return parseRecovering2;
    }
    ;
    if (dialect === "minbars") {
      return parseRecovering(minOptions);
    }
    ;
    if (dialect === "rawbars") {
      return parseRecovering3;
    }
    ;
    return parseRecovering(defaultParseOptions);
  })();
  return map36(parseErrorAt(src))(recover(src).errors);
};
var dataVars = ["index", "key", "first", "last", "parent-index", "parent-key", "parent-first", "parent-last"];
var ctx = function(kind) {
  return obj([tt2("context"), new Tuple("kind", str(kind))]);
};
var compileResultAt = function(src) {
  return function(v) {
    if (v instanceof Left) {
      return {
        ok: false,
        value: "",
        error: renderParseErrorAt(src)(v.value0)
      };
    }
    ;
    if (v instanceof Right) {
      return {
        ok: true,
        value: v.value0,
        error: ""
      };
    }
    ;
    throw new Error("Failed pattern match at ClassicBars.JS (line 745, column 23 - line 747, column 49): " + [v.constructor.name]);
  };
};
var compileSurface2 = function(tpl) {
  return compileResultAt(tpl)(compileSurface(tpl));
};
var compileMinbarsWithPartials = function(partials, tpl) {
  return compileResultAt(tpl)(compileMinJsWith(toUnfoldable13(partials))(tpl));
};
var compileMinbarsCompatWithPartials = function(partials, tpl) {
  return compileResultAt(tpl)(compileMinJsCompatWith(toUnfoldable13(partials))(tpl));
};
var compileMinbarsCompat = function(tpl) {
  return compileResultAt(tpl)(compileMinJsCompat(tpl));
};
var compileMinbars = function(tpl) {
  return compileResultAt(tpl)(compileMinJs(tpl));
};
var compileMaxbarsWithPartials = function(partials, tpl) {
  return compileResultAt(tpl)(compileMaxJsWith(toUnfoldable13(partials))(tpl));
};
var compileMaxbars = function(tpl) {
  return compileResultAt(tpl)(compileMaxJs(tpl));
};
var compileFor = function(dialect, tpl) {
  return compileResultAt(tpl)((function() {
    if (dialect === "rawbars") {
      return compileJs(tpl);
    }
    ;
    if (dialect === "maxbars") {
      return compileMaxJs(tpl);
    }
    ;
    if (dialect === "minbars") {
      return compileMinJs(tpl);
    }
    ;
    return compileSurface(tpl);
  })());
};
var compile2 = function(tpl) {
  return compileResultAt(tpl)(compileJs(tpl));
};
var arr = id;
var rexpr = function(v) {
  if (v instanceof Lit) {
    return obj([tt2("lit"), new Tuple("value", rlit(v.value0))]);
  }
  ;
  if (v instanceof App2 && (v.value0 === "this" && v.value1.length === 0)) {
    return ctx("this");
  }
  ;
  if (v instanceof App2 && (v.value0 === "root" && v.value1.length === 0)) {
    return ctx("root");
  }
  ;
  if (v instanceof App2 && (v.value0 === "parent" && v.value1.length === 0)) {
    return ctx("parent");
  }
  ;
  if (v instanceof App2 && v.value0 === "lookup") {
    return path(v.value1);
  }
  ;
  if (v instanceof App2 && v.value1.length === 0) {
    var $116 = elem23(v.value0)(dataVars);
    if ($116) {
      return obj([tt2(v.value0)]);
    }
    ;
    return obj([tt2("identifier"), new Tuple("name", str(v.value0))]);
  }
  ;
  if (v instanceof App2) {
    return obj([tt2("call"), new Tuple("name", str(v.value0)), new Tuple("args", arr(map36(argOf)(v.value1)))]);
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.JS (line 1008, column 9 - line 1017, column 99): " + [v.constructor.name]);
};
var path = function(args) {
  var v = uncons(args);
  if (v instanceof Just && (v.value0.head instanceof App2 && (v.value0.head.value0 === "this" && v.value0.head.value1.length === 0))) {
    var $122 = $$null(v.value0.tail);
    if ($122) {
      return ctx("this");
    }
    ;
    return obj([tt2("path"), new Tuple("segments", arr(map36(segment)(v.value0.tail)))]);
  }
  ;
  return obj([tt2("call"), new Tuple("name", str("lookup")), new Tuple("args", arr(map36(argOf)(args)))]);
};
var argOf = function(e) {
  return obj([new Tuple("value", rexpr(e))]);
};
var $lazy_rnode = /* @__PURE__ */ $runtime_lazy9("rnode", "ClassicBars.JS", function() {
  var children = function(ns) {
    return arr(map36($lazy_rnode(978))(ns));
  };
  return function(v) {
    if (v instanceof RText) {
      return obj([tt2("text"), new Tuple("text", str(v.value1)), srcOf(v.value0)]);
    }
    ;
    if (v instanceof ROut) {
      var v1 = partialName3(v.value2);
      if (v1 instanceof Just) {
        return obj([tt2("partial"), new Tuple("name", str(v1.value0)), srcOf(v.value0)]);
      }
      ;
      if (v1 instanceof Nothing) {
        return obj([tt2("emit"), new Tuple("expr", rexpr(v.value2)), new Tuple("escape", str((function() {
          if (v.value1) {
            return "html";
          }
          ;
          return "none";
        })())), srcOf(v.value0)]);
      }
      ;
      throw new Error("Failed pattern match at ClassicBars.JS (line 929, column 24 - line 937, column 10): " + [v1.constructor.name]);
    }
    ;
    if (v instanceof RIf) {
      return obj([tt2("if"), new Tuple("cond", rexpr(v.value1)), new Tuple("then", children(v.value2)), new Tuple("else", children(v.value3)), srcOf(v.value0)]);
    }
    ;
    if (v instanceof RUnless) {
      return obj([tt2("unless"), new Tuple("cond", rexpr(v.value1)), new Tuple("then", children(v.value2)), new Tuple("else", children(v.value3)), srcOf(v.value0)]);
    }
    ;
    if (v instanceof REach) {
      return obj([tt2("each"), new Tuple("subject", rexpr(v.value1)), new Tuple("body", children(v.value2)), new Tuple("else", children(v.value3)), srcOf(v.value0)]);
    }
    ;
    if (v instanceof RWith) {
      return obj([tt2("with"), new Tuple("subject", rexpr(v.value1)), new Tuple("body", children(v.value2)), new Tuple("else", children(v.value3)), srcOf(v.value0)]);
    }
    ;
    var v1 = function(v2) {
      var v3 = function(v4) {
        if (v instanceof RCall) {
          return obj([tt2(v.value1), new Tuple("args", arr(map36(argOf)(v.value2))), new Tuple("body", children(v.value3)), srcOf(v.value0)]);
        }
        ;
        if (v instanceof RSep2) {
          return obj([tt2("sep"), new Tuple("name", str(v.value1)), new Tuple("args", arr(map36(argOf)(v.value2))), srcOf(v.value0)]);
        }
        ;
        if (v instanceof RRaw2) {
          return obj([tt2("raw"), new Tuple("text", str(v.value1)), srcOf(v.value0)]);
        }
        ;
        throw new Error("Failed pattern match at ClassicBars.JS (line 924, column 1 - line 924, column 23): " + [v.constructor.name]);
      };
      if (v instanceof RCall && v.value1 === "partial") {
        var $164 = litName2(v.value2);
        if ($164 instanceof Just) {
          return obj([tt2("partial"), new Tuple("name", str($164.value0)), new Tuple("body", children(v.value3)), srcOf(v.value0)]);
        }
        ;
        return v3(true);
      }
      ;
      return v3(true);
    };
    if (v instanceof RCall && v.value1 === "inline") {
      var $171 = litName2(v.value2);
      if ($171 instanceof Just) {
        return obj([tt2("inline"), new Tuple("name", str($171.value0)), new Tuple("body", children(v.value3)), srcOf(v.value0)]);
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
});
var rnode = /* @__PURE__ */ $lazy_rnode(924);
var astJson = function(dialect, src) {
  var recover = (function() {
    if (dialect === "maxbars") {
      return parseRecovering2;
    }
    ;
    if (dialect === "core") {
      return parseRecovering3;
    }
    ;
    if (dialect === "minbars") {
      return parseRecovering(minOptions);
    }
    ;
    return parseRecovering(defaultParseOptions);
  })();
  var r = recover(src);
  var errJson = function(pe) {
    var d = parseErrorAt(src)(pe);
    return obj([new Tuple("message", str(d.message)), new Tuple("line", $$int(d.line)), new Tuple("column", $$int(d.column)), new Tuple("offset", $$int(d.offset))]);
  };
  var desugared = (function() {
    if (dialect === "core") {
      return r.nodes;
    }
    ;
    if (dialect === "maxbars") {
      return desugarSurfaceWith(maxLoopVars)(r.nodes);
    }
    ;
    if (dialect === "minbars") {
      return desugar2(r.nodes);
    }
    ;
    return desugarSurface(r.nodes);
  })();
  var nodes = lower(desugared);
  return obj([new Tuple("ast", obj([new Tuple("version", str("flatbars-ast/v1")), new Tuple("nodes", arr(map36(rnode)(nodes)))])), new Tuple("errors", arr(map36(errJson)(r.errors)))]);
};
var analyseResult = function(v) {
  if (v instanceof Left) {
    return {
      ok: false,
      findings: [],
      report: "",
      jsonata: "",
      output: "",
      evaluated: 0,
      error: v.value0
    };
  }
  ;
  if (v instanceof Right) {
    return {
      ok: true,
      findings: v.value0.findings,
      report: v.value0.report,
      jsonata: v.value0.jsonata,
      output: v.value0.output,
      evaluated: v.value0.evaluated,
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at ClassicBars.JS (line 181, column 17 - line 191, column 6): " + [v.constructor.name]);
};
var analyze = function(tpl, json) {
  return analyseResult(analyseSurface(tpl)(fromJson(json)));
};
var analyzeMinbars = function(tpl, json) {
  return analyseResult(analyseMin(tpl)(fromJson(json)));
};
var analyzeWith = function(schema, tpl, json) {
  return analyseResult(analyseSurfaceWith(toPathSchema(schema))(tpl)(fromJson(json)));
};
export {
  analyze,
  analyzeMinbars,
  analyzeWith,
  astJson,
  compile2 as compile,
  compileFor,
  compileMaxbars,
  compileMaxbarsWithPartials,
  compileMinbars,
  compileMinbarsCompat,
  compileMinbarsCompatWithPartials,
  compileMinbarsWithPartials,
  compileSurface2 as compileSurface,
  diagnostics,
  highlightSpans4 as highlightSpans,
  inferMaxbars,
  inferMaxbarsData,
  inspect,
  inspectMaxbars,
  inspectMinbars,
  inspectMinbarsCompat,
  inspectSurface,
  lint,
  migrate,
  render,
  renderMapped2 as renderMapped,
  renderMappedWithPartials,
  renderMaxWith,
  renderMaxbars,
  renderMaxbarsMapped,
  renderMaxbarsMappedWithPartials,
  renderMaxbarsWithPartials,
  renderMinbars,
  renderMinbarsCompat,
  renderMinbarsCompatWithPartials,
  renderMinbarsMapped,
  renderMinbarsMappedCompat,
  renderMinbarsMappedCompatWithPartials,
  renderMinbarsMappedWithPartials,
  renderMustache,
  renderRawWith,
  renderSurface,
  renderSurfaceI18n2 as renderSurfaceI18n,
  renderSurfaceMapped2 as renderSurfaceMapped,
  renderSurfaceMappedWithPartials,
  renderSurfaceWithPartials,
  renderWith,
  safe,
  tokenize2 as tokenize
};
