// output/FullBars.JS/foreign.js
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

// output/Data.Functor/index.js
var map = function(dict) {
  return dict.map;
};
var mapFlipped = function(dictFunctor) {
  var map111 = map(dictFunctor);
  return function(fa) {
    return function(f) {
      return map111(f)(fa);
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
  var map27 = map(dictApply.Functor0());
  return function(a) {
    return function(b) {
      return apply1(map27($$const(identity2))(a))(b);
    };
  };
};

// output/Control.Applicative/index.js
var pure = function(dict) {
  return dict.pure;
};
var when = function(dictApplicative) {
  var pure12 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      if (v) {
        return v1;
      }
      ;
      if (!v) {
        return pure12(unit);
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
  var bind12 = bind(dictBind);
  return function(m) {
    return bind12(m)(identity3);
  };
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

// output/Data.Bounded/foreign.js
var topInt = 2147483647;
var bottomInt = -2147483648;
var topChar = String.fromCharCode(65535);
var bottomChar = String.fromCharCode(0);
var topNumber = Number.POSITIVE_INFINITY;
var bottomNumber = Number.NEGATIVE_INFINITY;

// output/Data.Ord/foreign.js
var unsafeCompareImpl = function(lt) {
  return function(eq6) {
    return function(gt) {
      return function(x) {
        return function(y) {
          return x < y ? lt : x === y ? eq6 : gt;
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
var eqString = {
  eq: eqStringImpl
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
var notEq = function(dictEq) {
  var eq34 = eq(dictEq);
  return function(x) {
    return function(y) {
      return eq2(eq34(x)(y))(false);
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
  var compare3 = compare(dictOrd);
  return function(f) {
    return function(x) {
      return function(y) {
        return compare3(f(x))(f(y));
      };
    };
  };
};
var max = function(dictOrd) {
  var compare3 = compare(dictOrd);
  return function(x) {
    return function(y) {
      var v = compare3(x)(y);
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
  var compare3 = compare(dictOrd);
  return function(x) {
    return function(y) {
      var v = compare3(x)(y);
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

// output/Data.Show/index.js
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
  var eq6 = eq(dictEq);
  return {
    eq: function(x) {
      return function(y) {
        if (x instanceof Nothing && y instanceof Nothing) {
          return true;
        }
        ;
        if (x instanceof Just && y instanceof Just) {
          return eq6(x.value0)(y.value0);
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

// output/Control.Monad/index.js
var ap = function(dictMonad) {
  var bind9 = bind(dictMonad.Bind1());
  var pure8 = pure(dictMonad.Applicative0());
  return function(f) {
    return function(a) {
      return bind9(f)(function(f$prime) {
        return bind9(a)(function(a$prime) {
          return pure8(f$prime(a$prime));
        });
      });
    };
  };
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
  var append6 = append(dictMonoid.Semigroup0());
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
        return append6(x$prime)(x$prime);
      }
      ;
      if (otherwise) {
        var x$prime = go(div2(p)(2));
        return append6(x$prime)(append6(x$prime)(x));
      }
      ;
      throw new Error("Failed pattern match at Data.Monoid (line 88, column 3 - line 88, column 17): " + [p.constructor.name]);
    };
    return go;
  };
};

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
var empty = {};
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
var keys = Object.keys || toArrayWithKey(function(k) {
  return function() {
    return k;
  };
});

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

// output/Data.Array/foreign.js
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
  function Cons2(head3, tail2) {
    this.head = head3;
    this.tail = tail2;
  }
  var emptyList = {};
  function curryCons(head3) {
    return function(tail2) {
      return new Cons2(head3, tail2);
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
  return function(foldr2, xs) {
    return listToArray(foldr2(curryCons)(emptyList)(xs));
  };
})();
var length = function(xs) {
  return xs.length;
};
var unconsImpl = function(empty4, next, xs) {
  return xs.length === 0 ? empty4({}) : next(xs[0])(xs.slice(1));
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
  function mergeFromTo(compare3, fromOrdering, xs1, xs2, from2, to) {
    var mid;
    var i;
    var j;
    var k;
    var x;
    var y;
    var c;
    mid = from2 + (to - from2 >> 1);
    if (mid - from2 > 1) mergeFromTo(compare3, fromOrdering, xs2, xs1, from2, mid);
    if (to - mid > 1) mergeFromTo(compare3, fromOrdering, xs2, xs1, mid, to);
    i = from2;
    j = mid;
    k = from2;
    while (i < mid && j < to) {
      x = xs2[i];
      y = xs2[j];
      c = fromOrdering(compare3(x)(y));
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
  return function(compare3, fromOrdering, xs) {
    var out;
    if (xs.length < 2) return xs;
    out = xs.slice(0);
    mergeFromTo(compare3, fromOrdering, out, xs.slice(0), 0, xs.length);
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
  var pure8 = pure(dictApplicative);
  return function(dictFoldable) {
    var foldr2 = foldr(dictFoldable);
    return function(f) {
      return foldr2(function($454) {
        return applySecond2(f($454));
      })(pure8(unit));
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
  var foldr2 = foldr(dictFoldable);
  return function(dictMonoid) {
    var append6 = append(dictMonoid.Semigroup0());
    var mempty2 = mempty(dictMonoid);
    return function(f) {
      return foldr2(function(x) {
        return function(acc) {
          return append6(f(x))(acc);
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
    var eq23 = eq(dictEq);
    return function(a) {
      var $460 = foldMap22(function(v) {
        var $444 = eq23(a)(v.value0);
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
  return function(apply3) {
    return function(map27) {
      return function(pure8) {
        return function(f) {
          return function(array) {
            function go(bot, top3) {
              switch (top3 - bot) {
                case 0:
                  return pure8([]);
                case 1:
                  return map27(array1)(f(array[bot]));
                case 2:
                  return apply3(map27(array2)(f(array[bot])))(f(array[bot + 1]));
                case 3:
                  return apply3(apply3(map27(array3)(f(array[bot])))(f(array[bot + 1])))(f(array[bot + 2]));
                default:
                  var pivot = bot + Math.floor((top3 - bot) / 4) * 2;
                  return apply3(map27(concat2)(go(bot, pivot)))(go(pivot, top3));
              }
            }
            return go(0, array.length);
          };
        };
      };
    };
  };
})();

// output/Data.Traversable/index.js
var identity7 = /* @__PURE__ */ identity(categoryFn);
var traverse = function(dict) {
  return dict.traverse;
};
var traversableMaybe = {
  traverse: function(dictApplicative) {
    var pure8 = pure(dictApplicative);
    var map27 = map(dictApplicative.Apply0().Functor0());
    return function(v) {
      return function(v1) {
        if (v1 instanceof Nothing) {
          return pure8(Nothing.value);
        }
        ;
        if (v1 instanceof Just) {
          return map27(Just.create)(v(v1.value0));
        }
        ;
        throw new Error("Failed pattern match at Data.Traversable (line 115, column 1 - line 119, column 33): " + [v.constructor.name, v1.constructor.name]);
      };
    };
  },
  sequence: function(dictApplicative) {
    var pure8 = pure(dictApplicative);
    var map27 = map(dictApplicative.Apply0().Functor0());
    return function(v) {
      if (v instanceof Nothing) {
        return pure8(Nothing.value);
      }
      ;
      if (v instanceof Just) {
        return map27(Just.create)(v.value0);
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

// output/Data.Unfoldable/foreign.js
var unfoldrArrayImpl = function(isNothing2) {
  return function(fromJust5) {
    return function(fst2) {
      return function(snd2) {
        return function(f) {
          return function(b) {
            var result2 = [];
            var value = b;
            while (true) {
              var maybe2 = f(value);
              if (isNothing2(maybe2)) return result2;
              var tuple = fromJust5(maybe2);
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
  return function(fromJust5) {
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
              value = fromJust5(maybe2);
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
var foldl2 = /* @__PURE__ */ foldl(foldableArray);
var foldM = function(dictMonad) {
  var pure12 = pure(dictMonad.Applicative0());
  var bind12 = bind(dictMonad.Bind1());
  return function(f) {
    return function(b) {
      return runFn3(unconsImpl)(function(v) {
        return pure12(b);
      })(function(a) {
        return function(as) {
          return bind12(f(b)(a))(function(b$prime) {
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
  var eq23 = eq(dictEq);
  return function(x) {
    return findIndex(function(v) {
      return eq23(v)(x);
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
var nubByEq = function(eq23) {
  return function(xs) {
    return (function __do() {
      var arr2 = newSTArray();
      foreach(xs)(function(x) {
        return function __do2() {
          var e = map22((function() {
            var $194 = any2(function(v) {
              return eq23(v)(x);
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
var toUnfoldable2 = function(dictUnfoldable) {
  var $89 = toUnfoldable(dictUnfoldable);
  var $90 = toArrayWithKey(Tuple.create);
  return function($91) {
    return $89($90($91));
  };
};
var lookup2 = /* @__PURE__ */ (function() {
  return runFn4(_lookup)(Nothing.value)(Just.create);
})();
var fromFoldable2 = function(dictFoldable) {
  var fromFoldable13 = fromFoldable(dictFoldable);
  return function(l) {
    return runST(function __do() {
      var s = newImpl();
      foreach(fromFoldable13(l))(function(v) {
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
var size2 = function(v) {
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
var singleton5 = function(k) {
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
        return singleton5(k)(v);
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
  var compare3 = compare(dictOrd);
  return function(app) {
    return function(m1) {
      return function(m2) {
        return unsafeUnionWith(compare3, app, m1, m2);
      };
    };
  };
};
var union = function(dictOrd) {
  return unionWith(dictOrd)($$const);
};
var lookup3 = function(dictOrd) {
  var compare3 = compare(dictOrd);
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
          var v1 = compare3(k)(v.value2);
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
  var eq15 = eq(dictEq);
  return function(dictEq1) {
    var eq23 = eq(dictEq1);
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
                if (v2 instanceof IterNext && (eq15(v.value0)(v2.value0) && eq23(v.value1)(v2.value1))) {
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
var toUnfoldable3 = function(dictUnfoldable) {
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
var insert = function(dictOrd) {
  var compare3 = compare(dictOrd);
  return function(k) {
    return function(v) {
      var go = function(v1) {
        if (v1 instanceof Leaf) {
          return singleton5(k)(v);
        }
        ;
        if (v1 instanceof Node) {
          var v2 = compare3(k)(v1.value2);
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
var eqMap = function(dictEq) {
  var eqMapIter1 = eqMapIter(dictEq);
  return function(dictEq1) {
    var eq15 = eq(eqMapIter1(dictEq1));
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
              return eq15(toMapIter(xs))(toMapIter(ys));
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
var empty3 = /* @__PURE__ */ (function() {
  return Leaf.value;
})();
var fromFoldable3 = function(dictOrd) {
  var insert1 = insert(dictOrd);
  return function(dictFoldable) {
    return foldl(dictFoldable)(function(m) {
      return function(v) {
        return insert1(v.value0)(v.value1)(m);
      };
    })(empty3);
  };
};
var alter = function(dictOrd) {
  var compare3 = compare(dictOrd);
  return function(f) {
    return function(k) {
      return function(m) {
        var v = unsafeSplit(compare3, k, m);
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
var fromEnum = function(dict) {
  return dict.fromEnum;
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

// output/Data.String.CodeUnits/foreign.js
var fromCharArray = function(a) {
  return a.join("");
};
var toCharArray = function(s) {
  return s.split("");
};
var singleton6 = function(c) {
  return c;
};
var length2 = function(s) {
  return s.length;
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

// output/Data.String.CodePoints/index.js
var fromEnum2 = /* @__PURE__ */ fromEnum(boundedEnumChar);
var map5 = /* @__PURE__ */ map(functorMaybe);
var unfoldr2 = /* @__PURE__ */ unfoldr(unfoldableArray);
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
var uncons3 = function(s) {
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
  return map5(function(v) {
    return new Tuple(v.head, v.tail);
  })(uncons3(s));
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
    return map5(function(i) {
      return length3(take2(i)(s));
    })(lastIndexOf(p)(s));
  };
};
var indexOf2 = function(p) {
  return function(s) {
    return map5(function(i) {
      return length3(take2(i)(s));
    })(indexOf(p)(s));
  };
};

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
      throw new Error("Failed pattern match at FlatBars.Span (line 32, column 11 - line 34, column 37): " + [v.constructor.name]);
    })();
    return {
      line: nls + 1 | 0,
      column: col
    };
  };
};

// output/FlatBars.Error/index.js
var show2 = /* @__PURE__ */ show(showInt);
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
  throw new Error("Failed pattern match at FlatBars.Error (line 71, column 20 - line 82, column 27): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FlatBars.Error (line 51, column 21 - line 64, column 95): " + [v.constructor.name]);
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
    return "ParseFailure: " + renderParseError(v.value0);
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Error (line 133, column 15 - line 141, column 61): " + [v.constructor.name]);
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

// output/Data.List/index.js
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
var head2 = function(v) {
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
  function Content2(value0) {
    this.value0 = value0;
  }
  ;
  Content2.create = function(value0) {
    return new Content2(value0);
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

// output/FlatBars.Token/index.js
var eq12 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
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
var tokenizeInterior = function(cfg) {
  return function(base) {
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
      var arithChar = function(c) {
        return c === "+" || (c === "-" || (c === "*" || (c === "/" || c === "?")));
      };
      var identChar = function(c) {
        return isIdentChar(c) && !(cfg.infixArith && arithChar(c));
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
                        throw new Error("Failed pattern match at FlatBars.Token (line 172, column 23 - line 174, column 76): " + [v2.constructor.name]);
                      }
                      ;
                      if (v1 instanceof Nothing) {
                        $tco_done = true;
                        return new Left(new LexError("unterminated string", base + start | 0));
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Token (line 171, column 24 - line 175, column 76): " + [v1.constructor.name]);
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
                  throw new Error("Failed pattern match at FlatBars.Token (line 166, column 23 - line 176, column 60): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Token (line 155, column 7 - line 157, column 87): " + [v.constructor.name]);
        };
      };
      var readIdent = function(start) {
        return function(acc) {
          var bracketEnd = function($copy_k) {
            var $tco_done2 = false;
            var $tco_result;
            function $tco_loop(k) {
              if (k > len) {
                $tco_done2 = true;
                return Nothing.value;
              }
              ;
              if (eq12(at(k))(new Just("]"))) {
                $tco_done2 = true;
                return new Just(k);
              }
              ;
              if (otherwise) {
                $copy_k = k + 1 | 0;
                return;
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Token (line 144, column 5 - line 147, column 39): " + [k.constructor.name]);
            }
            ;
            while (!$tco_done2) {
              $tco_result = $tco_loop($copy_k);
            }
            ;
            return $tco_result;
          };
          var scan = function($copy_j) {
            var $tco_done3 = false;
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
                  $tco_done3 = true;
                  return new Left(new LexError("unterminated [ segment", base + j | 0));
                }
                ;
                throw new Error("Failed pattern match at FlatBars.Token (line 139, column 19 - line 141, column 71): " + [v1.constructor.name]);
              }
              ;
              if (v instanceof Just && identChar(v.value0)) {
                $copy_j = j + 1 | 0;
                return;
              }
              ;
              $tco_done3 = true;
              return go(j)(push4(acc)(new TIdent(slc(start)(j)))(start)(j));
            }
            ;
            while (!$tco_done3) {
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
          var $tco_done4 = false;
          var $tco_result;
          function $tco_loop(i, acc) {
            if (i >= len) {
              $tco_done4 = true;
              return new Right(acc);
            }
            ;
            if (otherwise) {
              var v = at(i);
              if (v instanceof Nothing) {
                $tco_done4 = true;
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
                  $tco_done4 = true;
                  return readString(i)(v.value0)(acc);
                }
                ;
                if (v.value0 === "&") {
                  var $61 = eq12(at(i + 1 | 0))(new Just("&"));
                  if ($61) {
                    $tco_done4 = true;
                    return op2("&&")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return bad(i);
                }
                ;
                if (v.value0 === "|") {
                  var $62 = eq12(at(i + 1 | 0))(new Just("|"));
                  if ($62) {
                    $tco_done4 = true;
                    return op2("||")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return op1("|")(i)(acc);
                }
                ;
                if (v.value0 === "!") {
                  var $63 = eq12(at(i + 1 | 0))(new Just("="));
                  if ($63) {
                    $tco_done4 = true;
                    return op2("!=")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return op1("!")(i)(acc);
                }
                ;
                if (v.value0 === "<") {
                  var $64 = eq12(at(i + 1 | 0))(new Just("="));
                  if ($64) {
                    $tco_done4 = true;
                    return op2("<=")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return op1("<")(i)(acc);
                }
                ;
                if (v.value0 === ">") {
                  var $65 = eq12(at(i + 1 | 0))(new Just("="));
                  if ($65) {
                    $tco_done4 = true;
                    return op2(">=")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return op1(">")(i)(acc);
                }
                ;
                if (v.value0 === "=") {
                  var $66 = eq12(at(i + 1 | 0))(new Just("="));
                  if ($66) {
                    $tco_done4 = true;
                    return op2("==")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return bad(i);
                }
                ;
                if (v.value0 === "-" && maybe(false)(isDigit)(at(i + 1 | 0))) {
                  $tco_done4 = true;
                  return readNumber(i)(acc);
                }
                ;
                if (cfg.infixArith && v.value0 === "?") {
                  var $67 = eq12(at(i + 1 | 0))(new Just("?"));
                  if ($67) {
                    $tco_done4 = true;
                    return op2("??")(i)(acc);
                  }
                  ;
                  $tco_done4 = true;
                  return bad(i);
                }
                ;
                if (cfg.infixArith && arithChar(v.value0)) {
                  $tco_done4 = true;
                  return op1(singleton6(v.value0))(i)(acc);
                }
                ;
                if (cfg.infixArith && v.value0 === "%") {
                  $tco_done4 = true;
                  return op1("%")(i)(acc);
                }
                ;
                if (isDigit(v.value0)) {
                  $tco_done4 = true;
                  return readNumber(i)(acc);
                }
                ;
                if (identChar(v.value0) || v.value0 === "[") {
                  $tco_done4 = true;
                  return readIdent(i)(acc);
                }
                ;
                if (otherwise) {
                  $tco_done4 = true;
                  return bad(i);
                }
                ;
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Token (line 102, column 19 - line 127, column 31): " + [v.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Token (line 99, column 3 - line 99, column 68): " + [i.constructor.name, acc.constructor.name]);
          }
          ;
          while (!$tco_done4) {
            $tco_result = $tco_loop($tco_var_i, $copy_acc);
          }
          ;
          return $tco_result;
        };
      };
      return go(0)([]);
    };
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
      if (x instanceof TOp && y instanceof TOp) {
        return x.value0 === y.value0;
      }
      ;
      return false;
    };
  }
};
var defaultLexOptions = {
  infixArith: false
};

// output/FlatBars.Lexer/index.js
var eq13 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var notEq3 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var elem3 = /* @__PURE__ */ elem2(eqChar);
var fromFoldable4 = /* @__PURE__ */ fromFoldable(foldableList);
var bind2 = /* @__PURE__ */ bind(bindMaybe);
var map6 = /* @__PURE__ */ map(functorEither);
var elem1 = /* @__PURE__ */ elem2(eqString);
var RContent = /* @__PURE__ */ (function() {
  function RContent2(value0) {
    this.value0 = value0;
  }
  ;
  RContent2.create = function(value0) {
    return new RContent2(value0);
  };
  return RContent2;
})();
var ROutput = /* @__PURE__ */ (function() {
  function ROutput2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  ROutput2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new ROutput2(value0, value1, value2, value3);
        };
      };
    };
  };
  return ROutput2;
})();
var RAmp = /* @__PURE__ */ (function() {
  function RAmp2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RAmp2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RAmp2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RAmp2;
})();
var ROpen = /* @__PURE__ */ (function() {
  function ROpen2(value0, value1, value2, value3, value4) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
  }
  ;
  ROpen2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return new ROpen2(value0, value1, value2, value3, value4);
          };
        };
      };
    };
  };
  return ROpen2;
})();
var RClose = /* @__PURE__ */ (function() {
  function RClose2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RClose2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RClose2(value0, value1, value2, value3);
        };
      };
    };
  };
  return RClose2;
})();
var RSep = /* @__PURE__ */ (function() {
  function RSep3(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RSep3.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RSep3(value0, value1, value2, value3);
        };
      };
    };
  };
  return RSep3;
})();
var RRaw = /* @__PURE__ */ (function() {
  function RRaw3(value0, value1, value2, value3, value4, value5) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
    this.value4 = value4;
    this.value5 = value5;
  }
  ;
  RRaw3.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return function(value4) {
            return function(value5) {
              return new RRaw3(value0, value1, value2, value3, value4, value5);
            };
          };
        };
      };
    };
  };
  return RRaw3;
})();
var RComment = /* @__PURE__ */ (function() {
  function RComment2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RComment2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RComment2(value0, value1, value2);
      };
    };
  };
  return RComment2;
})();
var RSetDelim = /* @__PURE__ */ (function() {
  function RSetDelim2(value0) {
    this.value0 = value0;
  }
  ;
  RSetDelim2.create = function(value0) {
    return new RSetDelim2(value0);
  };
  return RSetDelim2;
})();
var RLongComment = /* @__PURE__ */ (function() {
  function RLongComment2(value0) {
    this.value0 = value0;
  }
  ;
  RLongComment2.create = function(value0) {
    return new RLongComment2(value0);
  };
  return RLongComment2;
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
  return fromCharArray(takeWhile(function($398) {
    return !isSpace($398);
  })(cs));
};
var trimEndWs = function(s) {
  return fromCharArray(reverse(dropWhile(isSpace)(reverse(toCharArray(s)))));
};
var trimStartWs = function(s) {
  return fromCharArray(dropWhile(isSpace)(toCharArray(s)));
};
var hasNL = function(s) {
  return notEq3(nlIndex(true)(s))(Nothing.value);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 106, column 3 - line 109, column 29): " + [i.constructor.name]);
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
  return function(lexOpts) {
    return function(src) {
      var validDelim = function(d) {
        return !elem3("=")(toCharArray(d));
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
        return fromCharArray(takeWhile(function($399) {
          return !isSpace($399);
        })(dropWhile(isSpace)(toCharArray(s))));
      };
      var interiorAt = function(base) {
        return function(s) {
          return tokenizeInterior(lexOpts)(base)(s);
        };
      };
      var flush = function(s0) {
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
              var $195 = s2 === "";
              if ($195) {
                return acc;
              }
              ;
              return new Cons(new RContent(s2), acc);
            };
          };
        };
      };
      var finalize = function($400) {
        return fromFoldable4(reverse2($400));
      };
      var delimWords = function(s) {
        var a0 = dropWhile(isSpace)(toCharArray(s));
        var a1 = dropWhile(isSpace)(dropWhile(function($401) {
          return !isSpace($401);
        })(a0));
        var rest = dropWhile(isSpace)(dropWhile(function($402) {
          return !isSpace($402);
        })(a1));
        var w2 = takeWhile(function($403) {
          return !isSpace($403);
        })(a1);
        var w1 = takeWhile(function($404) {
          return !isSpace($404);
        })(a0);
        var $196 = $$null(w1) || ($$null(w2) || !$$null(rest));
        if ($196) {
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
        var v = bind2(stripPrefix("@delimiters")(t))((function() {
          var $405 = stripPrefix(":");
          return function($406) {
            return $405(trimStartWs($406));
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 407, column 7 - line 414, column 100): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 394, column 58 - line 397, column 39): " + [v1.constructor.name]);
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 439, column 3 - line 439, column 41): " + [i.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 468, column 70 - line 470, column 20): " + [v.constructor.name]);
        })());
      };
      var escapedOpenerAt = function(i) {
        var v = openerLiteralAt(i);
        if (v instanceof Just) {
          return new Just(v.value0);
        }
        ;
        if (v instanceof Nothing) {
          var $216 = isSeparatorAt(i);
          if ($216) {
            return new Just("{{");
          }
          ;
          return Nothing.value;
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 479, column 23 - line 481, column 62): " + [v.constructor.name]);
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 473, column 18 - line 475, column 31): " + [v.constructor.name]);
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
      var readAmp = function(i) {
        return function(opener) {
          var start = i + length2(opener) | 0;
          var v = findFrom(cs)(start)("}}");
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 599, column 7 - line 610, column 16): " + [v.constructor.name]);
        };
      };
      var readBlockOpen = function(i) {
        return function(opener) {
          return function(sigil) {
            return function(close) {
              var start = i + length2(opener) | 0;
              var cl = length2(close);
              var v = findFrom(cs)(start)(close);
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
              throw new Error("Failed pattern match at FlatBars.Lexer (line 558, column 7 - line 570, column 16): " + [v.constructor.name]);
            };
          };
        };
      };
      var readClose = function(i) {
        return function(opener) {
          return function(close) {
            var start = i + length2(opener) | 0;
            var cl = length2(close);
            var v = findFrom(cs)(start)(close);
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
            throw new Error("Failed pattern match at FlatBars.Lexer (line 580, column 7 - line 591, column 16): " + [v.constructor.name]);
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
            throw new Error("Failed pattern match at FlatBars.Lexer (line 766, column 7 - line 797, column 77): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 661, column 30 - line 668, column 8): " + [v.constructor.name]);
        };
      };
      var readOutput = function(i) {
        var start = i + 3 | 0;
        var v = findFrom(cs)(start)("}}}");
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 536, column 7 - line 547, column 16): " + [v.constructor.name]);
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
            var head3 = slice3(cs)(start)(v.value0);
            var closePat = "{{{{/" + (rawName(head3) + "}}}}");
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
                }, sigil === 5, start, head3, interiorAt(start)(head3), slice3(cs)(bodyStart2)(v1.value0))),
                next: end,
                trimL: false,
                trimR: false
              });
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Lexer (line 688, column 13 - line 702, column 22): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 677, column 7 - line 702, column 22): " + [v.constructor.name]);
        };
      };
      var readSeparator = function(i) {
        var start = (function() {
          var $247 = leadTrimAt(i);
          if ($247) {
            return i + 3 | 0;
          }
          ;
          return i + 2 | 0;
        })();
        var v = findFrom(cs)(start)("}}");
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 620, column 7 - line 631, column 16): " + [v.constructor.name]);
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
              throw new Error("Failed pattern match at FlatBars.Lexer (line 724, column 19 - line 735, column 88): " + [v1.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Lexer (line 721, column 7 - line 735, column 88): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 642, column 7 - line 654, column 16): " + [v.constructor.name]);
        };
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 483, column 3 - line 483, column 48): " + [i.constructor.name]);
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
                        return new Right(flush(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                      }
                      ;
                      if (otherwise) {
                        var v = index(cs)(i);
                        if (v instanceof Nothing) {
                          $tco_done = true;
                          return new Right(flush(contentTo(segStart)(frags)(i))(acc)(pend)(false));
                        }
                        ;
                        if (v instanceof Just) {
                          if (cfg.mustacheDelims && matchAt(cs)(i)(open + "=")) {
                            var v1 = readSetDelim(i)(open)(close);
                            if (v1 instanceof Left) {
                              $tco_done = true;
                              return new Left(v1.value0);
                            }
                            ;
                            if (v1 instanceof Right) {
                              var acc11 = flush(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL);
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
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 334, column 65 - line 340, column 82): " + [v1.constructor.name]);
                          }
                          ;
                          if (open === "{{" && (close === "}}" && v.value0 === "\\")) {
                            var $269 = matchAt(cs)(i + 1 | 0)("\\");
                            if ($269) {
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
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 348, column 20 - line 354, column 98): " + [v1.constructor.name]);
                          }
                          ;
                          if (open === "{{" && (close === "}}" && (v.value0 === "{" && isOpenerAt(i)))) {
                            var v1 = readTag(i);
                            if (v1 instanceof Left) {
                              $tco_done = true;
                              return new Left(v1.value0);
                            }
                            ;
                            if (v1 instanceof Right) {
                              var acc2 = consTok(v1.value0.mtok)(flush(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
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
                              throw new Error("Failed pattern match at FlatBars.Lexer (line 361, column 19 - line 364, column 92): " + [v2.constructor.name]);
                            }
                            ;
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 355, column 74 - line 364, column 92): " + [v1.constructor.name]);
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
                              return new Left(v1.value0);
                            }
                            ;
                            if (v1 instanceof Right) {
                              var acc2 = consTok(v1.value0.mtok)(flush(contentTo(segStart)(frags)(i))(acc)(pend)(v1.value0.trimL));
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
                              throw new Error("Failed pattern match at FlatBars.Lexer (line 374, column 19 - line 377, column 92): " + [v2.constructor.name]);
                            }
                            ;
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 368, column 34 - line 377, column 92): " + [v1.constructor.name]);
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
                        throw new Error("Failed pattern match at FlatBars.Lexer (line 328, column 19 - line 378, column 71): " + [v.constructor.name]);
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Lexer (line 317, column 3 - line 325, column 39): " + [i.constructor.name, open.constructor.name, close.constructor.name, segStart.constructor.name, frags.constructor.name, acc.constructor.name, pend.constructor.name]);
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
      return map6(finalize)(go(0)(cfg.open)(cfg.close)(0)([])(Nil.value)(false));
    };
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 246, column 24 - line 248, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 239, column 21 - line 241, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 232, column 19 - line 234, column 15): " + [v.constructor.name]);
};
var allWs = /* @__PURE__ */ (function() {
  var $407 = all2(isSpace);
  return function($408) {
    return $407(toCharArray($408));
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 227, column 17 - line 229, column 15): " + [v.constructor.name]);
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
            if (hasNL(v.value0.value0)) {
              $tco_done = true;
              return allWs(beforeFirstNL(v.value0.value0));
            }
            ;
            if (allWs(v.value0.value0)) {
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 186, column 17 - line 192, column 22): " + [v.constructor.name]);
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
            if (hasNL(v.value0.value0)) {
              $tco_done1 = true;
              return allWs(afterLastNL(v.value0.value0));
            }
            ;
            if (allWs(v.value0.value0)) {
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 174, column 16 - line 180, column 22): " + [v.constructor.name]);
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
            var $395 = standaloneAt(j - 1 | 0);
            if ($395) {
              return dropLeadingLine(v.value0);
            }
            ;
            return v.value0;
          })();
          var s2 = (function() {
            var $396 = standaloneAt(j + 1 | 0);
            if ($396) {
              return dropTrailingIndent(s1);
            }
            ;
            return s1;
          })();
          return new RContent(s2);
        }
        ;
        return v;
      };
    };
    return mapWithIndex2(trimContent)(toks);
  };
};

// output/FlatBars.Highlight/index.js
var eq14 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var append3 = /* @__PURE__ */ append(semigroupArray);
var elem4 = /* @__PURE__ */ elem2(eqString);
var isSpace2 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var trimmedChars = /* @__PURE__ */ (function() {
  var $59 = dropWhile(isSpace2);
  return function($60) {
    return $59(toCharArray($60));
  };
})();
var isPartialHead = function(s) {
  return eq14(head(trimmedChars(s)))(new Just(">"));
};
var headWord = function(s) {
  return fromCharArray(takeWhile(function($61) {
    return !isSpace2($61);
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
      throw new Error("Failed pattern match at FlatBars.Highlight (line 170, column 19 - line 172, column 51): " + [v2.constructor.name]);
    };
    var openSpans = function(sp) {
      return function(sig) {
        return function($$int2) {
          if (sig instanceof Section) {
            return append3(tag(sp)("block-open"))(carveInterior($$int2));
          }
          ;
          if (sig instanceof PartialBlock) {
            return append3(tag(sp)("block-open"))(carveInterior($$int2));
          }
          ;
          if (sig instanceof Decorator) {
            return append3(tag(sp)("block-open"))(carveInterior($$int2));
          }
          ;
          if (sig instanceof Inverse) {
            if (cfg.extras) {
              return append3(tag(sp)("block-inverse"))(carveInterior($$int2));
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
              return append3(tag(sp)("block-parent"))(carveInterior($$int2));
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
              return append3(tag(sp)("block-decl"))(carveInterior($$int2));
            }
            ;
            if (otherwise) {
              return tag(sp)("error");
            }
            ;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Highlight (line 148, column 26 - line 162, column 36): " + [sig.constructor.name]);
        };
      };
    };
    var spansOf = function(v2) {
      if (v2 instanceof RContent) {
        return [];
      }
      ;
      if (v2 instanceof ROutput) {
        return append3(tag(v2.value0)("raw"))(carveInterior(v2.value3));
      }
      ;
      if (v2 instanceof RAmp) {
        if (cfg.extras) {
          return append3(tag(v2.value0)("raw"))(carveInterior(v2.value3));
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
        return append3(tag(v2.value0)("block-close"))(carveInterior(v2.value3));
      }
      ;
      if (v2 instanceof RSep) {
        if (isPartialHead(v2.value2)) {
          return tag(v2.value0)("partial");
        }
        ;
        if (elem4(headWord(v2.value2))(cfg.clauseSeps)) {
          return append3(tag(v2.value0)("keyword"))(carveInterior(v2.value3));
        }
        ;
        if (otherwise) {
          return append3(tag(v2.value0)("expr"))(carveInterior(v2.value3));
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
      throw new Error("Failed pattern match at FlatBars.Highlight (line 114, column 13 - line 141, column 43): " + [v2.constructor.name]);
    };
    var v = tokenizeTemplate(cfg.lexConfig)(cfg.lexOptions)(src);
    if (v instanceof Left) {
      return [];
    }
    ;
    if (v instanceof Right) {
      return concatMap(spansOf)(v.value0);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Highlight (line 109, column 25 - line 111, column 45): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Highlight (line 193, column 3 - line 193, column 34): " + [s.constructor.name]);
    };
    return mapMaybe(tagOnly)(tokenizeSpans(cfg)(src));
  };
};

// output/FlatBars.Json/index.js
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
var map7 = /* @__PURE__ */ map(functorArray);
var fromFoldable5 = /* @__PURE__ */ fromFoldable2(foldableArray);
var toUnfoldable4 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var fromFoldable1 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var toUnfoldable1 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
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
    return id(map7(toJson)(v.value0));
  }
  ;
  if (v instanceof VObject) {
    return id(fromFoldable5(map7(function(v1) {
      return new Tuple(v1.value0, toJson(v1.value1));
    })(toUnfoldable4(v.value0))));
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Json (line 35, column 10 - line 47, column 6): " + [v.constructor.name]);
};
var $lazy_fromJson = /* @__PURE__ */ $runtime_lazy3("fromJson", "FlatBars.Json", function() {
  return caseJson(function(v) {
    return VNull.value;
  })(VBool.create)(VNumber.create)(VString.create)(function(arr2) {
    return new VArray(map7($lazy_fromJson(25))(arr2));
  })(function(obj2) {
    return new VObject(fromFoldable1(map7(function(v) {
      return new Tuple(v.value0, $lazy_fromJson(28)(v.value1));
    })(toUnfoldable1(obj2))));
  });
});
var fromJson = /* @__PURE__ */ $lazy_fromJson(19);

// output/FlatBars.Expr/index.js
var map8 = /* @__PURE__ */ map(functorMaybe);
var bind3 = /* @__PURE__ */ bind(bindEither);
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
      throw new Error("Failed pattern match at FlatBars.Expr (line 36, column 16 - line 38, column 19): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Expr (line 34, column 13 - line 38, column 19): " + [v2.constructor.name]);
  };
  var pExpr = function(i) {
    var v2 = tk(i);
    if (v2 instanceof Just && v2.value0 instanceof TLParen) {
      return bind3(pExpr(i + 1 | 0))(function(v1) {
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
      return bind3(pArgs(i + 1 | 0)([]))(function(v1) {
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
        return bind3(pExpr(i))(function(v1) {
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
  throw new Error("Failed pattern match at FlatBars.Expr (line 26, column 18 - line 30, column 66): " + [v.constructor.name]);
};

// output/FlatBars.Parser/index.js
var eq3 = /* @__PURE__ */ eq(eqToken);
var eq22 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var fromFoldable6 = /* @__PURE__ */ fromFoldable(foldableList);
var eq32 = /* @__PURE__ */ eq(eqSigil);
var append4 = /* @__PURE__ */ append(semigroupArray);
var identity8 = /* @__PURE__ */ identity(categoryFn);
var StopEOF = /* @__PURE__ */ (function() {
  function StopEOF2() {
  }
  ;
  StopEOF2.value = new StopEOF2();
  return StopEOF2;
})();
var StopClose = /* @__PURE__ */ (function() {
  function StopClose2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  StopClose2.create = function(value0) {
    return function(value1) {
      return new StopClose2(value0, value1);
    };
  };
  return StopClose2;
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
var outputExpr = function(pe) {
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
      throw new Error("Failed pattern match at FlatBars.Parser (line 324, column 22 - line 328, column 27): " + [v.constructor.name]);
    };
  };
};
var isSpace3 = function(c) {
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
        throw new Error("Failed pattern match at FlatBars.Parser (line 272, column 3 - line 275, column 35): " + [k.constructor.name]);
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
        var $55 = maybe(false)(isSpace3)(at(k));
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
          throw new Error("Failed pattern match at FlatBars.Parser (line 277, column 3 - line 277, column 50): " + [j.constructor.name, acc.constructor.name]);
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
var headedRecovering = function(pe) {
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
          var v1 = pe(partialHead(v.value0));
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
          throw new Error("Failed pattern match at FlatBars.Parser (line 383, column 20 - line 386, column 84): " + [v1.constructor.name]);
        }
        ;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Parser (line 379, column 28 - line 386, column 84): " + [v.constructor.name]);
    };
  };
};
var headed = function(pe) {
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
          var v1 = pe(partialHead(v.value0));
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
          throw new Error("Failed pattern match at FlatBars.Parser (line 341, column 20 - line 344, column 50): " + [v1.constructor.name]);
        }
        ;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Parser (line 337, column 18 - line 344, column 50): " + [v.constructor.name]);
    };
  };
};
var parseSeq = function(pe) {
  return function(ph) {
    return function(gates) {
      return function(toks) {
        var done = function(acc) {
          return function(errs) {
            return function(stop) {
              return {
                nodes: fromFoldable6(reverse2(acc)),
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
                    $tco_var_acc = new Cons(new Content(v.value0.value0), acc);
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
                  if (v.value0 instanceof ROutput) {
                    var v1 = outputExpr(pe)(v.value0.value0)(v.value0.value3);
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
                    throw new Error("Failed pattern match at FlatBars.Parser (line 460, column 31 - line 462, column 57): " + [v1.constructor.name]);
                  }
                  ;
                  if (v.value0 instanceof RAmp) {
                    if (!gates.extras) {
                      $tco_done = true;
                      return recover(acc)(errs)(v.value0.value0)(new DisallowedShape("{{& }} (unescaped output)", v.value0.value0.start))(i + 1 | 0);
                    }
                    ;
                    if (otherwise) {
                      var v1 = outputExpr(pe)(v.value0.value0)(v.value0.value3);
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
                      throw new Error("Failed pattern match at FlatBars.Parser (line 468, column 24 - line 470, column 61): " + [v1.constructor.name]);
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
                      var v1 = headed(pe)(v.value0.value0)(v.value0.value4);
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
                      throw new Error("Failed pattern match at FlatBars.Parser (line 481, column 24 - line 483, column 80): " + [v1.constructor.name]);
                    }
                    ;
                  }
                  ;
                  if (v.value0 instanceof RSep) {
                    var v1 = headed(pe)(v.value0.value0)(v.value0.value3);
                    if (v1 instanceof Right) {
                      $tco_var_acc = new Cons(new Sep(v.value0.value0, v1.value0.name, v1.value0.args), acc);
                      $tco_var_errs = errs;
                      $copy_i = i + 1 | 0;
                      return;
                    }
                    ;
                    if (v1 instanceof Left && (v1.value0 instanceof HeadNotIdent && trim(v.value0.value2) !== "")) {
                      var v2 = outputExpr(pe)(v.value0.value0)(v.value0.value3);
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
                      throw new Error("Failed pattern match at FlatBars.Parser (line 492, column 29 - line 494, column 63): " + [v2.constructor.name]);
                    }
                    ;
                    if (v1 instanceof Left) {
                      $tco_done = true;
                      return recover(acc)(errs)(v.value0.value0)(v1.value0)(i + 1 | 0);
                    }
                    ;
                    throw new Error("Failed pattern match at FlatBars.Parser (line 484, column 28 - line 495, column 50): " + [v1.constructor.name]);
                  }
                  ;
                  if (v.value0 instanceof RClose) {
                    var v1 = headed(pe)({
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
                    throw new Error("Failed pattern match at FlatBars.Parser (line 496, column 33 - line 500, column 60): " + [v1.constructor.name]);
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
                  throw new Error("Failed pattern match at FlatBars.Parser (line 455, column 15 - line 535, column 74): " + [v.value0.constructor.name]);
                }
                ;
                throw new Error("Failed pattern match at FlatBars.Parser (line 453, column 19 - line 535, column 74): " + [v.constructor.name]);
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
                      var hr = headedRecovering(ph)(span2)(interior);
                      var errs1 = append4(errs)(catMaybes([gateErr, hr.error]));
                      if (hr.name instanceof Nothing) {
                        return go(new Cons(new NodeError(span2, maybe("parse error")(parseErrorMessage)(hr.error)), acc))(errs1)(i);
                      }
                      ;
                      if (hr.name instanceof Just) {
                        var inner = parseSeq(pe)(ph)(gates)(toks)(i);
                        var node = new Block(span2, sigil, hr.name.value0, hr.args, inner.nodes);
                        var errs2 = append4(errs1)(inner.errors);
                        if (inner.stop instanceof StopEOF) {
                          return go(new Cons(node, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, "<eof>", span2.start)))(length(toks));
                        }
                        ;
                        if (inner.stop instanceof StopClose) {
                          if (inner.stop.value0 === hr.name.value0) {
                            return go(new Cons(node, acc))(errs2)(inner.stop.value1);
                          }
                          ;
                          if (otherwise) {
                            return go(new Cons(node, acc))(snoc(errs2)(new MismatchedBlock(hr.name.value0, inner.stop.value0, span2.start)))(inner.stop.value1);
                          }
                          ;
                        }
                        ;
                        throw new Error("Failed pattern match at FlatBars.Parser (line 565, column 13 - line 575, column 24): " + [inner.stop.constructor.name]);
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Parser (line 556, column 7 - line 575, column 24): " + [hr.name.constructor.name]);
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
    throw new Error("Failed pattern match at FlatBars.Parser (line 219, column 33 - line 227, column 8): " + [v.constructor.name]);
  };
};
var defaultParseOptions = {
  trimStandalone: true,
  parseExpr,
  parseHead: parseExpr,
  extras: true,
  inheritance: false,
  decorators: true,
  partialBlocks: true,
  rawBlockHbs: true,
  rawBlockHash: false,
  standaloneSeps: ["else", "elif"],
  lexOptions: defaultLexOptions,
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
              $copy_acc = append4(acc)(dirs);
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
            throw new Error("Failed pattern match at FlatBars.Parser (line 250, column 14 - line 252, column 42): " + [v1.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Parser (line 243, column 25 - line 254, column 35): " + [v.constructor.name]);
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
              var r = parseSeq(opts.parseExpr)(opts.parseHead)(gatesOf(opts))(toks)(idx);
              var nodes$prime = append4(accNodes)(r.nodes);
              var errs$prime = append4(accErrs)(r.errors);
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
              throw new Error("Failed pattern match at FlatBars.Parser (line 163, column 7 - line 166, column 63): " + [r.stop.constructor.name]);
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
    var v = tokenizeTemplate(opts.lexConfig)(opts.lexOptions)(src);
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
      var filtered = filter(function($171) {
        return !isComment($171);
      })(toks$prime);
      var seq = runSeq(filtered)(0)([])([]);
      var trimErrs = either(singleton2)($$const([]))(trimRes);
      var dirErrs = either(singleton2)($$const([]))(dirRes);
      return {
        directives,
        nodes: seq.nodes,
        errors: append4(dirErrs)(append4(trimErrs)(seq.errors))
      };
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 130, column 28 - line 147, column 82): " + [v.constructor.name]);
  };
};
var parseWith = function(opts) {
  return function(src) {
    var r = parseRecovering(opts)(src);
    var v = head(r.errors);
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
    throw new Error("Failed pattern match at FlatBars.Parser (line 180, column 5 - line 182, column 68): " + [v.constructor.name]);
  };
};
var parse = /* @__PURE__ */ parseWith(defaultParseOptions);
var buildFromTokens = function(opts) {
  return function(toks) {
    var r = parseSeq(opts.parseExpr)(opts.parseHead)(gatesOf(opts))(filter(function($172) {
      return !isComment($172);
    })(toks))(0);
    var v = head(r.errors);
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
        return new Left(new MismatchedBlock("<none>", r.stop.value0, 0));
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Parser (line 204, column 18 - line 206, column 67): " + [r.stop.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Parser (line 202, column 5 - line 206, column 67): " + [v.constructor.name]);
  };
};

// output/Control.Monad.Trans.Class/index.js
var lift = function(dict) {
  return dict.lift;
};

// output/Control.Monad.Writer.Class/index.js
var tell = function(dict) {
  return dict.tell;
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
      var bind9 = bind(dictMonad.Bind1());
      var pure8 = pure(dictMonad.Applicative0());
      return function(m) {
        return bind9(m)(function(a) {
          return pure8(new Tuple(a, mempty2));
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
  var map27 = map(dictFunctor);
  return {
    map: function(f) {
      return mapWriterT(map27(function(v) {
        return new Tuple(f(v.value0), v.value1);
      }));
    }
  };
};
var applyWriterT = function(dictSemigroup) {
  var append6 = append(dictSemigroup);
  return function(dictApply) {
    var apply3 = apply(dictApply);
    var Functor0 = dictApply.Functor0();
    var map27 = map(Functor0);
    var functorWriterT1 = functorWriterT(Functor0);
    return {
      apply: function(v) {
        return function(v1) {
          var k = function(v3) {
            return function(v4) {
              return new Tuple(v3.value0(v4.value0), append6(v3.value1)(v4.value1));
            };
          };
          return apply3(map27(k)(v))(v1);
        };
      },
      Functor0: function() {
        return functorWriterT1;
      }
    };
  };
};
var bindWriterT = function(dictSemigroup) {
  var append6 = append(dictSemigroup);
  var applyWriterT1 = applyWriterT(dictSemigroup);
  return function(dictBind) {
    var bind9 = bind(dictBind);
    var Apply0 = dictBind.Apply0();
    var map27 = map(Apply0.Functor0());
    var applyWriterT2 = applyWriterT1(Apply0);
    return {
      bind: function(v) {
        return function(k) {
          return bind9(v)(function(v1) {
            var v2 = k(v1.value0);
            return map27(function(v3) {
              return new Tuple(v3.value0, append6(v1.value1)(v3.value1));
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
    var pure8 = pure(dictApplicative);
    var applyWriterT2 = applyWriterT1(dictApplicative.Apply0());
    return {
      pure: function(a) {
        return pure8(new Tuple(a, mempty2));
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
    var applicativeWriterT2 = applicativeWriterT1(dictMonad.Applicative0());
    var bindWriterT2 = bindWriterT1(dictMonad.Bind1());
    return {
      Applicative0: function() {
        return applicativeWriterT2;
      },
      Bind1: function() {
        return bindWriterT2;
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

// output/FullBars.Surface/index.js
var foldl3 = /* @__PURE__ */ foldl(foldableArray);
var notEq1 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqString));
var map9 = /* @__PURE__ */ map(functorArray);
var elem5 = /* @__PURE__ */ elem2(eqString);
var append1 = /* @__PURE__ */ append(semigroupArray);
var pure2 = /* @__PURE__ */ pure(applicativeArray);
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
      throw new Error("Failed pattern match at FullBars.Surface (line 489, column 24 - line 491, column 32): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_s, $copy_depth);
    }
    ;
    return $tco_result;
  };
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
  throw new Error("Failed pattern match at FullBars.Surface (line 363, column 18 - line 365, column 34): " + [v.constructor.name]);
};
var segmentsOf = function(s) {
  var flush = function(st) {
    var $72 = st.cur === "";
    if ($72) {
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
        var $75 = c === "]";
        if ($75) {
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
          cur: st.cur + singleton6(c)
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
          cur: st.cur + singleton6(c)
        };
      }
      ;
      throw new Error("Failed pattern match at FullBars.Surface (line 515, column 3 - line 519, column 53): " + [st.constructor.name, c.constructor.name]);
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
  throw new Error("Failed pattern match at FullBars.Surface (line 524, column 14 - line 526, column 31): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at FullBars.Surface (line 106, column 1 - line 106, column 38): " + [lv.constructor.name, name2.constructor.name]);
  };
};
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
  throw new Error("Failed pattern match at FullBars.Surface (line 495, column 1 - line 495, column 23): " + [n.constructor.name]);
};
var noLoopVars = function(v) {
  return Nothing.value;
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
    throw new Error("Failed pattern match at FullBars.Surface (line 314, column 1 - line 314, column 85): " + [name2.constructor.name, args.constructor.name]);
  };
};
var extractBlockParams = function(args) {
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
  if (v instanceof Just && looksLikeParams(drop(v.value0 + 1 | 0)(args))) {
    return {
      mainArgs: take(v.value0)(args),
      params: paramNames(drop(v.value0 + 1 | 0)(args))
    };
  }
  ;
  return {
    mainArgs: args,
    params: []
  };
};
var expandElseIf = /* @__PURE__ */ (function() {
  var toElif = function(v) {
    var v1 = function(v2) {
      return v;
    };
    if (v instanceof Sep && v.value1 === "else") {
      var $114 = uncons(v.value2);
      if ($114 instanceof Just && ($114.value0.head instanceof App2 && ($114.value0.head.value0 === "if" && $114.value0.head.value1.length === 0))) {
        var $115 = !$$null($114.value0.tail);
        if ($115) {
          return new Sep(v.value0, "elif", $114.value0.tail);
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
  return map9(toElif);
})();
var dictExpr = function(pairs) {
  return new App2("dict", concatMap(function(p) {
    return [new Lit(new VString(p.key)), p.val];
  })(pairs));
};
var dataExpr = function(raw) {
  var v = stripParents(raw)(0);
  var prefix = (function() {
    var $125 = v.depth === 0;
    if ($125) {
      return "";
    }
    ;
    return "parent-";
  })();
  var v1 = uncons(segmentsOf(v.rest));
  if (v1 instanceof Just) {
    if ($$null(v1.value0.tail)) {
      return new App2(prefix + v1.value0.head, []);
    }
    ;
    if (otherwise) {
      return new App2("lookup", cons(new App2(prefix + v1.value0.head, []))(map9(segKey)(v1.value0.tail)));
    }
    ;
  }
  ;
  if (v1 instanceof Nothing) {
    return new App2("this", []);
  }
  ;
  throw new Error("Failed pattern match at FullBars.Surface (line 446, column 5 - line 450, column 31): " + [v1.constructor.name]);
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
            var $135 = $$null(tail2);
            if ($135) {
              return new App2(name2, []);
            }
            ;
            return new App2("lookup", cons(new App2(name2, []))(map9(segKey)(tail2)));
          };
        };
        var reserved = isJust(lv(reservedMarker));
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
            if (v1.depth === 0 && elem5(v2.value0.head)(scope)) {
              var $140 = $$null(v2.value0.tail);
              if ($140) {
                return new App2(v2.value0.head, []);
              }
              ;
              return new App2("lookup", cons(new App2(v2.value0.head, []))(map9(segKey)(v2.value0.tail)));
            }
            ;
            if (reserved && (v1.depth === 0 && v2.value0.head === "loop")) {
              return scopedHead("loop")(v2.value0.tail);
            }
            ;
            if (reserved && (v1.depth === 0 && v2.value0.head === "root")) {
              return scopedHead("root")(v2.value0.tail);
            }
            ;
            if (reserved && (v1.depth === 0 && v2.value0.head === "parent")) {
              return scopedHead("@parentchain")(v2.value0.tail);
            }
            ;
            if (reserved && (v1.depth === 0 && v2.value0.head === "yield")) {
              return scopedHead("yield")(v2.value0.tail);
            }
            ;
          }
          ;
          var v3 = function(v4) {
            var base = parents(v1.depth);
            var $144 = $$null(segs);
            if ($144) {
              return base;
            }
            ;
            return new App2("lookup", cons(base)(map9(segKey)(segs)));
          };
          if (v2 instanceof Just) {
            var $146 = v1.depth === 0 && $$null(v2.value0.tail);
            if ($146) {
              var $147 = lv(raw);
              if ($147 instanceof Just) {
                return new App2($147.value0, []);
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
        throw new Error("Failed pattern match at FullBars.Surface (line 389, column 7 - line 427, column 72): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at FullBars.Surface (line 385, column 1 - line 385, column 47): " + [lv.constructor.name, scope.constructor.name, raw.constructor.name]);
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
        throw new Error("Failed pattern match at FullBars.Surface (line 371, column 17 - line 373, column 37): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at FullBars.Surface (line 368, column 1 - line 368, column 49): " + [lv.constructor.name, scope.constructor.name, t.constructor.name]);
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
      throw new Error("Failed pattern match at FullBars.Surface (line 377, column 1 - line 377, column 48): " + [lv.constructor.name, scope.constructor.name, name2.constructor.name]);
    };
  };
};
var bareInlineOffset = function(nodes) {
  var node = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
      return new Just(v.value0.start);
    }
    ;
    if (v instanceof Block) {
      return bareInlineOffset(v.value4);
    }
    ;
    return Nothing.value;
  };
  return head(mapMaybe(node)(nodes));
};
var asHashKey = function(lv) {
  return function(scope) {
    return function(v) {
      if (v instanceof App2 && (v.value1.length === 0 && contains("=")(v.value0))) {
        var v1 = splitFirstEq(v.value0);
        return new Just((function() {
          var $175 = v1.rest === "";
          if ($175) {
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
      var $180 = $$null(h.pairs);
      if ($180) {
        return map9(rewrite(lv)(scope))(h.positional);
      }
      ;
      return snoc(map9(rewrite(lv)(scope))(h.positional))(dictExpr(h.pairs));
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
      throw new Error("Failed pattern match at FullBars.Surface (line 269, column 20 - line 273, column 56): " + [v.constructor.name]);
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
              throw new Error("Failed pattern match at FullBars.Surface (line 336, column 43 - line 339, column 92): " + [v2.constructor.name]);
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
            throw new Error("Failed pattern match at FullBars.Surface (line 335, column 28 - line 342, column 79): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FullBars.Surface (line 333, column 17 - line 342, column 79): " + [v.constructor.name]);
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
          var pos = map9(rewrite(lv)(scope))(h.positional);
          var withHash = (function() {
            var $200 = $$null(h.pairs);
            if ($200) {
              return pos;
            }
            ;
            return snoc(pos)(hashMarker(h.pairs));
          })();
          return append1(withHash)(append1(map9(paramMarker)(params))(labelMarker(label)));
        };
      };
    };
  };
};
var partialCall = function(lv) {
  return function(scope) {
    return function(nameExpr) {
      return function(valueArgs) {
        var h = collectHash(lv)(scope)(valueArgs);
        var ctx2 = maybe(new App2("this", []))(rewrite(lv)(scope))(head(h.positional));
        var $201 = $$null(h.pairs);
        if ($201) {
          return [nameExpr, ctx2];
        }
        ;
        return [nameExpr, ctx2, dictExpr(h.pairs)];
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
      throw new Error("Failed pattern match at FullBars.Surface (line 255, column 28 - line 257, column 34): " + [v.constructor.name]);
    };
  };
};
var partialArgs = function(lv) {
  return function(scope) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just) {
        return partialCall(lv)(scope)(partialName(lv)(scope)(v.value0.head))(v.value0.tail);
      }
      ;
      if (v instanceof Nothing) {
        return [new Lit(new VString("")), new App2("this", [])];
      }
      ;
      throw new Error("Failed pattern match at FullBars.Surface (line 249, column 29 - line 251, column 49): " + [v.constructor.name]);
    };
  };
};
var partialExpr = function(lv) {
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
            throw new Error("Failed pattern match at FullBars.Surface (line 226, column 13 - line 228, column 65): " + [v1.constructor.name]);
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
        return new App2("partial", partialCall(lv)(scope)(v.nameExpr)(v.valueArgs));
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
        throw new Error("Failed pattern match at FullBars.Surface (line 211, column 1 - line 211, column 64): " + [lv.constructor.name, scope.constructor.name, name2.constructor.name, args.constructor.name]);
      };
    };
  };
};
var desugarWith = function(lv) {
  return function(clauseNames) {
    var go = function(scope) {
      var node = function(v) {
        if (v instanceof Content) {
          return new Content(v.value0);
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
          if (elem5(v.value1)(clauseNames)) {
            return new Sep(v.value0, v.value1, rewriteArgs(lv)(scope)(v.value2));
          }
          ;
          if (otherwise) {
            var v1 = stripPrefix(">")(v.value1);
            if (v1 instanceof Just) {
              return new Output(v.value0, partialExpr(lv)(scope)(v1.value0)(v.value2));
            }
            ;
            if (v1 instanceof Nothing) {
              return new Output(v.value0, new App2("escapeHtml", [rewriteHead(lv)(scope)(v.value1)(v.value2)]));
            }
            ;
            throw new Error("Failed pattern match at FullBars.Surface (line 134, column 24 - line 138, column 87): " + [v1.constructor.name]);
          }
          ;
        }
        ;
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "partial")) {
          return new Block(v.value0, Section.value, "partial", partialArgs(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "inline")) {
          return new Block(v.value0, Section.value, "inline", inlineArgs(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && (v.value1 instanceof Decorator && v.value2 === "inline")) {
          return new Block(v.value0, Section.value, "inline", inlineArgs(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && v.value1 instanceof PartialBlock) {
          return new Block(v.value0, Section.value, "partial", partialArgs(lv)(scope)(cons(new App2(v.value2, []))(v.value3)), go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && v.value1 instanceof Inverse) {
          return new Block(v.value0, Section.value, "unless", [rewriteHead(lv)(scope)(v.value2)(v.value3)], go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && v.value1 instanceof Section) {
          var v1 = extractLabel(v.value2)(v.value3);
          var v2 = extractBlockParams(v1.args);
          var bodyScope = append1(scope)(append1(v2.params)(maybe([])(pure2)(v1.label)));
          return new Block(v.value0, Section.value, v.value2, blockHeadArgs(lv)(scope)(v2.mainArgs)(v2.params)(v1.label), go(bodyScope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block) {
          var v1 = extractBlockParams(v.value3);
          return new Block(v.value0, v.value1, v.value2, blockHeadArgs(lv)(scope)(v1.mainArgs)(v1.params)(Nothing.value), go(append1(scope)(v1.params))(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof RawBlock) {
          return new RawBlock(v.value0, v.value1, v.value2, v.value3);
        }
        ;
        throw new Error("Failed pattern match at FullBars.Surface (line 123, column 12 - line 186, column 61): " + [v.constructor.name]);
      };
      return map9(node);
    };
    return go([]);
  };
};
var desugar = /* @__PURE__ */ desugarWith(noLoopVars);

// output/Kernel.Walk/index.js
var map10 = /* @__PURE__ */ map(functorMaybe);
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
        body: take(bodyEnd)(v2.value0.tail)
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
  throw new Error("Failed pattern match at Kernel.Walk (line 177, column 22 - line 179, column 86): " + [v.constructor.name]);
};
var splitClause = function(name2) {
  return function(nodes) {
    var s = splitClauses(nodes);
    return {
      before: s.before,
      clause: map10(function(v) {
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
    throw new Error("Failed pattern match at Kernel.Walk (line 238, column 10 - line 240, column 22): " + [v.constructor.name]);
  }
};
var foldTemplate = function(alg) {
  var node = function(v) {
    if (v instanceof Content) {
      return alg.content(v.value0);
    }
    ;
    if (v instanceof Output) {
      return alg.output(v.value1);
    }
    ;
    if (v instanceof RawBlock) {
      return alg.raw(v.value1)(v.value2)(v.value3);
    }
    ;
    if (v instanceof Sep) {
      return alg.sep(v.value1)(v.value2);
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
    throw new Error("Failed pattern match at Kernel.Walk (line 154, column 10 - line 160, column 49): " + [v.constructor.name]);
  };
  var go = function(nodes) {
    return alg.concat(map12(node)(nodes));
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
  var append16 = append(dictMonoid.Semigroup0());
  var fold1 = fold2(dictMonoid);
  var foldMap1 = foldMap2(dictMonoid);
  return function(f) {
    var expr = function(g) {
      return function(sp) {
        return foldExpr({
          lit: function(v) {
            return mempty2;
          },
          app: function(name2) {
            return function(children) {
              return append16(g({
                name: name2,
                kind: AppRef.value,
                argc: length(children),
                span: sp
              }))(fold1(children));
            };
          }
        });
      };
    };
    var node = function(g) {
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
          return append16(g({
            name: v.value2,
            kind: BlockRef.value,
            argc: length(v.value3),
            span: v.value0
          }))(append16(foldMap1(expr(g)(v.value0))(v.value3))(foldRefs(dictMonoid)(g)(v.value4)));
        }
        ;
        if (v instanceof RawBlock) {
          return append16(g({
            name: v.value1,
            kind: RawRef.value,
            argc: length(v.value2),
            span: v.value0
          }))(foldMap1(expr(g)(v.value0))(v.value2));
        }
        ;
        if (v instanceof Sep) {
          return append16(g({
            name: v.value1,
            kind: SepRef.value,
            argc: length(v.value2),
            span: v.value0
          }))(foldMap1(expr(g)(v.value0))(v.value2));
        }
        ;
        if (v instanceof NodeError) {
          return mempty2;
        }
        ;
        throw new Error("Failed pattern match at Kernel.Walk (line 95, column 12 - line 106, column 28): " + [v.constructor.name]);
      };
    };
    return foldMap1(node(f));
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
  throw new Error("Failed pattern match at Kernel.Walk (line 252, column 13 - line 256, column 30): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at Kernel.Walk (line 245, column 15 - line 249, column 19): " + [a.constructor.name]);
  };
};

// output/Kernel.Engine/index.js
var traverse2 = /* @__PURE__ */ traverse(traversableArray);
var traverse12 = /* @__PURE__ */ traverse(traversableMaybe);
var runTemplate = function(dictMonad) {
  var Bind1 = dictMonad.Bind1();
  var map27 = map(Bind1.Apply0().Functor0());
  var Applicative0 = dictMonad.Applicative0();
  var traverse22 = traverse2(Applicative0);
  var pure8 = pure(Applicative0);
  var bind9 = bind(Bind1);
  var traverse32 = traverse12(Applicative0);
  return function(engine) {
    var renderTemplate = function(env) {
      return function(nodes) {
        return map27(joinWith(""))(traverse22(renderNode(env))(nodes));
      };
    };
    var renderNode = function(env) {
      return function(v) {
        if (v instanceof Content) {
          return pure8(v.value0);
        }
        ;
        if (v instanceof Output) {
          return bind9(evalExpr(env)(v.value0)(v.value1))(engine.stringify);
        }
        ;
        if (v instanceof Block) {
          return applyBlock(env)(v.value0)(v.value2)(v.value3)(v.value4);
        }
        ;
        if (v instanceof RawBlock) {
          return applyBlock(env)(v.value0)(v.value1)(v.value2)([new Content(v.value3)]);
        }
        ;
        if (v instanceof Sep) {
          return bind9(evalExpr(env)(v.value0)(new App2(v.value1, v.value2)))(engine.stringify);
        }
        ;
        if (v instanceof NodeError) {
          return pure8("");
        }
        ;
        throw new Error("Failed pattern match at Kernel.Engine (line 91, column 20 - line 105, column 29): " + [v.constructor.name]);
      };
    };
    var evalExpr = function(env) {
      return function(span2) {
        return function(v) {
          if (v instanceof Lit) {
            return pure8(v.value0);
          }
          ;
          if (v instanceof App2) {
            return bind9(traverse22(evalExpr(env)(span2))(v.value1))(function(vals) {
              return bind9(engine.resolve(env)(v.value0))(function(h) {
                return h(ctl(env)([])(span2)(Nothing.value)([])(Nothing.value))(vals);
              });
            });
          }
          ;
          throw new Error("Failed pattern match at Kernel.Engine (line 116, column 23 - line 121, column 50): " + [v.constructor.name]);
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
    var applyBlock = function(env) {
      return function(span2) {
        return function(name2) {
          return function(args) {
            return function(body) {
              var split2 = engine.blockArgs(args);
              return bind9(traverse22(evalExpr(env)(span2))(split2.positional))(function(vals) {
                return bind9(traverse32(evalExpr(env)(span2))(split2.hash))(function(hashV) {
                  return bind9(engine.resolve(env)(name2))(function(h) {
                    return bind9(h(ctl(env)(body)(span2)(hashV)(split2.params)(split2.label))(vals))(engine.stringify);
                  });
                });
              });
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
var map11 = /* @__PURE__ */ map(functorEither);
var traverse3 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var foldMap3 = /* @__PURE__ */ foldMap(foldableArray)(monoidString);
var map13 = /* @__PURE__ */ map(functorArray);
var power2 = /* @__PURE__ */ power(monoidString);
var toUnfoldable5 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
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
var stringify2 = function(v) {
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
    return map11(joinWith(","))(traverse3(stringify2)(v.value0));
  }
  ;
  if (v instanceof VObject) {
    return new Left(new $$TypeError("cannot stringify an object"));
  }
  ;
  throw new Error("Failed pattern match at Kernel.Value (line 126, column 13 - line 133, column 61): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at Kernel.Value (line 84, column 12 - line 91, column 20): " + [v.constructor.name]);
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
    return singleton6(c);
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
            return open + ("\n" + (joinWith(",\n")(map13(function(it) {
              return power2(mIndent.value0)(depth + 1 | 0) + it;
            })(items)) + ("\n" + (power2(mIndent.value0)(depth) + close))));
          }
          ;
          throw new Error("Failed pattern match at Kernel.Value (line 182, column 32 - line 190, column 17): " + [mIndent.constructor.name]);
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
      throw new Error("Failed pattern match at Kernel.Value (line 177, column 11 - line 179, column 19): " + [mIndent.constructor.name]);
    })();
    var member = function(v) {
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
        return container("[")("]")(map13(renderJson(mIndent)(depth + 1 | 0))(v.value0));
      }
      ;
      if (v instanceof VObject) {
        return container("{")("}")(map13(member)(toUnfoldable5(v.value0)));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 165, column 28 - line 174, column 70): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at Kernel.Value (line 50, column 14 - line 57, column 36): " + [v.constructor.name]);
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
var union2 = /* @__PURE__ */ union(ordString);
var insert2 = /* @__PURE__ */ insert(ordString);
var foldl4 = /* @__PURE__ */ foldl(foldableArray);
var lookup4 = /* @__PURE__ */ lookup3(ordString);
var withTruthy = function(tf) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      depth: v.depth,
      truthy: tf
    };
  };
};
var registerPartials = function(ps) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      truthy: v.truthy,
      depth: v.depth,
      partials: union2(ps)(v.partials)
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
          depth: v.depth,
          helpers: new Cons(singleton5(name2)(h), Nil.value)
        };
      }
      ;
      if (v.helpers instanceof Cons) {
        return {
          context: v.context,
          partials: v.partials,
          truthy: v.truthy,
          depth: v.depth,
          helpers: new Cons(insert2(name2)(h)(v.helpers.value0), v.helpers.value1)
        };
      }
      ;
      throw new Error("Failed pattern match at Kernel.Env (line 112, column 37 - line 114, column 61): " + [v.helpers.constructor.name]);
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
var refTruthy = function(v) {
  return v.truthy;
};
var refDepth = function(v) {
  return v.depth;
};
var refContext = function(v) {
  return v.context;
};
var recursionBudget = 64;
var pushFrame = function(frame) {
  return function(ctx2) {
    return function(v) {
      return {
        partials: v.partials,
        truthy: v.truthy,
        depth: v.depth,
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
          throw new Error("Failed pattern match at Kernel.Env (line 124, column 19 - line 126, column 23): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at Kernel.Env (line 123, column 3 - line 123, column 19): " + [v1.constructor.name]);
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
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var liftEither1 = liftEither(dictMonadThrow);
  return function(onMissing) {
    return function(initial) {
      return {
        initial,
        resolve: function(env) {
          return function(name2) {
            var v = lookupOperation(name2)(env);
            if (v instanceof Just) {
              return pure8(v.value0);
            }
            ;
            if (v instanceof Nothing) {
              return onMissing(env)(name2);
            }
            ;
            throw new Error("Failed pattern match at Kernel.Env (line 166, column 27 - line 168, column 36): " + [v.constructor.name]);
          };
        },
        stringify: function(v) {
          return liftEither1(stringify2(v));
        },
        blockArgs: splitBlockArgs
      };
    };
  };
};
var refEngine = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  return refEngineWith(dictMonadThrow)(function(v) {
    return function(name2) {
      return throwError3(new UnknownHelper(name2));
    };
  });
};
var enterPartial = function(v) {
  return {
    context: v.context,
    helpers: v.helpers,
    partials: v.partials,
    truthy: v.truthy,
    depth: v.depth + 1 | 0
  };
};
var emptyEnv = function(ctx2) {
  return {
    context: ctx2,
    helpers: new Cons(empty3, Nil.value),
    partials: empty3,
    truthy: handlebars,
    depth: 0
  };
};
var constOperation = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      return function(v2) {
        return pure8(v);
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
var map14 = /* @__PURE__ */ map(functorArray);
var union3 = /* @__PURE__ */ union(ordString);
var fromFoldable7 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var map15 = /* @__PURE__ */ map(functorMaybe);
var lookup5 = /* @__PURE__ */ lookup3(ordString);
var notEq4 = /* @__PURE__ */ notEq(eqValue);
var sub2 = /* @__PURE__ */ sub(ringNumber);
var mul2 = /* @__PURE__ */ mul(semiringNumber);
var div3 = /* @__PURE__ */ div(euclideanRingNumber);
var traverse4 = /* @__PURE__ */ traverse(traversableArray);
var elem6 = /* @__PURE__ */ elem2(eqValue);
var alter2 = /* @__PURE__ */ alter(ordString);
var map23 = /* @__PURE__ */ map(functorMap);
var insert3 = /* @__PURE__ */ insert(ordString);
var compare2 = /* @__PURE__ */ compare(ordNumber);
var compare12 = /* @__PURE__ */ compare(ordString);
var max3 = /* @__PURE__ */ max(ordInt);
var min3 = /* @__PURE__ */ min(ordInt);
var discard2 = /* @__PURE__ */ discard(discardUnit);
var append12 = /* @__PURE__ */ append(semigroupArray);
var identity9 = /* @__PURE__ */ identity(categoryFn);
var toUnfoldable6 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var eq42 = /* @__PURE__ */ eq(eqOrdering);
var notEq12 = /* @__PURE__ */ notEq(eqOrdering);
var add1 = /* @__PURE__ */ add(semiringNumber);
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
  var pure8 = pure(dictApplicative);
  return function(v) {
    if (v instanceof VArray) {
      return pure8(new VArray(nubByEq(eq4)(v.value0)));
    }
    ;
    return pure8(new VArray([]));
  };
};
var thisH = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(ctl) {
    return function(v) {
      return pure8(refContext(ctl.env));
    };
  };
};
var stringifyM = function(dictMonadThrow) {
  var $804 = liftEither(dictMonadThrow);
  return function($805) {
    return $804(stringify2($805));
  };
};
var toFloatH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(v) {
    return bind9(stringifyM1(v))(function(s) {
      return pure8(maybe(VNull.value)(VNumber.create)(fromString(s)));
    });
  };
};
var toIntH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(v) {
    return bind9(stringifyM1(v))(function(s) {
      return pure8(maybe(VNull.value)(function($806) {
        return VNumber.create(trunc($806));
      })(fromString(s)));
    });
  };
};
var strUnary = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(f) {
    return function(v) {
      return map32(function($807) {
        return VString.create(f($807));
      })(stringifyM1(v));
    };
  };
};
var startsWithH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
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
          throw new Error("Failed pattern match at Kernel.Prelude (line 771, column 24 - line 773, column 21): " + [v.constructor.name]);
        };
      };
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure8(new VBool(isJustPrefix(x)(s)));
        });
      });
    };
  };
};
var splitH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(sepv) {
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(sepv))(function(sep) {
          return pure8(new VArray(map14(VString.create)(split(sep)(s))));
        });
      });
    };
  };
};
var scopedCanonical = /* @__PURE__ */ (function() {
  return [new Tuple("index", "index0"), new Tuple("partial-block", "yield")];
})();
var safe2 = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    return map32(VSafe.create)(stringifyM1(v));
  };
};
var reverseCodeUnits = function($808) {
  return fromCharArray(reverse(toCharArray($808)));
};
var reverseH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure8 = pure(Monad0.Applicative0());
  var map32 = map(Monad0.Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    if (v instanceof VArray) {
      return pure8(new VArray(reverse(v.value0)));
    }
    ;
    if (v instanceof VString) {
      return pure8(new VString(reverseCodeUnits(v.value0)));
    }
    ;
    return map32(function($809) {
      return VString.create(reverseCodeUnits($809));
    })(stringifyM1(v));
  };
};
var replaceH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      if (args.length === 3) {
        return bind9(stringifyM1(args[0]))(function(s) {
          return bind9(stringifyM1(args[1]))(function(find3) {
            return bind9(stringifyM1(args[2]))(function(rep) {
              return pure8(new VString(replaceAll(find3)(rep)(s)));
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
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  return function(ctl) {
    return function(env) {
      return function(nodes) {
        return map32(VSafe.create)(ctl.render(env)(nodes));
      };
    };
  };
};
var rawH = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  return function(ctl) {
    return function(v) {
      return map32(VSafe.create)(ctl.render(ctl.env)(ctl.children));
    };
  };
};
var prependH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure8(new VString(x + s));
        });
      });
    };
  };
};
var passthrough = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var liftEither2 = liftEither(dictMonadThrow);
  return function(name2) {
    return function(v) {
      return function(args) {
        var v1 = head(args);
        if (v1 instanceof Nothing) {
          return throwError3(new ArityError(name2 + ": expected at least 1 argument(s), got 0"));
        }
        ;
        if (v1 instanceof Just) {
          return map32(VString.create)(liftEither2(stringify2(v1.value0)));
        }
        ;
        throw new Error("Failed pattern match at Kernel.Prelude (line 1030, column 27 - line 1032, column 49): " + [v1.constructor.name]);
      };
    };
  };
};
var translateH = function(dictMonadThrow) {
  return passthrough(dictMonadThrow)("t");
};
var partialH = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var mergeHash = function(ctx2) {
        return function(opts) {
          if (opts instanceof VObject) {
            if (ctx2 instanceof VObject) {
              return new VObject(union3(opts.value0)(ctx2.value0));
            }
            ;
            return new VObject(opts.value0);
          }
          ;
          return ctx2;
        };
      };
      var blockFrame = (function() {
        var $586 = $$null(ctl.children);
        if ($586) {
          return empty3;
        }
        ;
        var body = function(v) {
          return function(v1) {
            return map32(VSafe.create)(ctl.render(ctl.env)(ctl.children));
          };
        };
        return fromFoldable7([new Tuple("partial-block", body), new Tuple("yield", body)]);
      })();
      var renderPartial = function(name2) {
        return function(ctx2) {
          var v = lookupPartial(name2)(ctl.env);
          if (v instanceof Just) {
            if (refDepth(ctl.env) >= recursionBudget) {
              return throwError3(new RecursionLimit(recursionBudget));
            }
            ;
            if (otherwise) {
              var entered = enterPartial(pushFrame(blockFrame)(ctx2)(ctl.env));
              return map32(VSafe.create)(ctl.render(entered)(v.value0));
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
              return map32(VSafe.create)(ctl.render(ctl.env)(ctl.children));
            }
            ;
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 1464, column 28 - line 1476, column 63): " + [v.constructor.name]);
        };
      };
      if (args.length === 2 && args[0] instanceof VString) {
        return renderPartial(args[0].value0)(args[1]);
      }
      ;
      if (args.length === 3 && args[0] instanceof VString) {
        return renderPartial(args[0].value0)(mergeHash(args[1])(args[2]));
      }
      ;
      return throwError3(new $$TypeError("partial: expected (name string, context, [options])"));
    };
  };
};
var parentData = function(ctl) {
  var rebind = function(v) {
    return map15(Tuple.create(v.value0))(lookupOperation(v.value1)(ctl.env));
  };
  return mapMaybe(rebind)([new Tuple("parent-index", "index"), new Tuple("parent-key", "key"), new Tuple("parent-first", "first"), new Tuple("parent-last", "last")]);
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
var numberH = function(dictMonadThrow) {
  return passthrough(dictMonadThrow)("number");
};
var notH = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        return pure8(new VBool(!refTruthy(ctl.env)(args[0])));
      }
      ;
      return throwError3(new ArityError("not: expected exactly 1 argument"));
    };
  };
};
var ne$prime = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(a) {
    return function(b) {
      return pure8(new VBool(notEq4(a)(b)));
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
  return [new Tuple("index", "index0"), new Tuple("index0", "index0"), new Tuple("index1", "index1"), new Tuple("rindex", "rindex0"), new Tuple("rindex0", "rindex0"), new Tuple("rindex1", "rindex1"), new Tuple("first", "first"), new Tuple("last", "last"), new Tuple("key", "key"), new Tuple("length", "length"), new Tuple("size", "length")];
})();
var jsonText = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(name2) {
    return function(args) {
      if (args.length === 1) {
        return pure8(jsonStringify(args[0]));
      }
      ;
      if (args.length === 2) {
        return pure8((function() {
          var $606 = optFlag("pretty")(args[1]);
          if ($606) {
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
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var jsonText1 = jsonText(dictMonadThrow);
  return function(v) {
    return function(args) {
      return map32(VString.create)(jsonText1("json")(args));
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
  var bind9 = bind(Bind1);
  var stringifyM1 = stringifyM(dictMonadThrow);
  var Applicative0 = Monad0.Applicative0();
  var traverse13 = traverse4(Applicative0);
  var pure8 = pure(Applicative0);
  var map32 = map(Bind1.Apply0().Functor0());
  return function(av) {
    return function(sepv) {
      return bind9(stringifyM1(sepv))(function(sep) {
        if (av instanceof VArray) {
          return bind9(traverse13(stringifyM1)(av.value0))(function(parts) {
            return pure8(new VString(joinWith(sep)(parts)));
          });
        }
        ;
        return map32(VString.create)(stringifyM1(av));
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
        throw new Error("Failed pattern match at Kernel.Prelude (line 1185, column 1 - line 1185, column 62): " + [tf.constructor.name, opts.constructor.name, v.constructor.name]);
      };
      var $619 = optFlag("includeZero")(opts);
      if ($619) {
        var $620 = isZeroNum(v);
        if ($620) {
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
  var pure8 = pure(Monad0.Applicative0());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var map32 = map(Bind1.Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(clauses) {
      var v = uncons(clauses);
      if (v instanceof Nothing) {
        return pure8(new VSafe(""));
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
              return bind9(ctl["eval"](ctl.env)(condE))(function(cond) {
                return bind9((function() {
                  if (mOpts instanceof Nothing) {
                    return pure8(refTruthy(ctl.env)(cond));
                  }
                  ;
                  if (mOpts instanceof Just) {
                    return map32(function(opts) {
                      return truthyWith(refTruthy(ctl.env))(opts)(cond);
                    })(ctl["eval"](ctl.env)(mOpts.value0));
                  }
                  ;
                  throw new Error("Failed pattern match at Kernel.Prelude (line 1143, column 16 - line 1146, column 18): " + [mOpts.constructor.name]);
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 1129, column 26 - line 1148, column 82): " + [v.constructor.name]);
    };
  };
};
var inlineH = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      return pure8(new VSafe(""));
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 1064, column 38 - line 1066, column 19): " + [v2.constructor.name]);
    }
    ;
    return VNull.value;
  };
};
var lookupH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
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
        return pure8(foldl2(step2)(v1.value0.head)(v1.value0.tail));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1001, column 18 - line 1003, column 59): " + [v1.constructor.name]);
    };
  };
};
var includesH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure8 = pure(Monad0.Applicative0());
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(sv) {
    return function(xv) {
      if (sv instanceof VArray) {
        return pure8(new VBool(elem6(xv)(sv.value0)));
      }
      ;
      if (sv instanceof VString) {
        return bind9(stringifyM1(xv))(function(sub22) {
          return pure8(new VBool(contains(sub22)(sv.value0)));
        });
      }
      ;
      return pure8(new VBool(false));
    };
  };
};
var gen = function(name2) {
  return function(doc) {
    return function(block) {
      return function(arity) {
        return function(run3) {
          return {
            name: name2,
            doc,
            block,
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
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  var foldM2 = foldM(Monad0);
  return function(av) {
    return function(keyv) {
      var insertGroup = function(key) {
        return function(acc) {
          return function(el) {
            return bind9(stringifyM1(extractPath(key)(el)))(function(k) {
              return pure8(alter2(function(mv) {
                return new Just(cons(el)(fromMaybe([])(mv)));
              })(k)(acc));
            });
          };
        };
      };
      return bind9(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return bind9(foldM2(insertGroup(key))(empty3)(av.value0))(function(grouped) {
            return pure8(new VObject(map23(function($810) {
              return VArray.create(reverse($810));
            })(grouped)));
          });
        }
        ;
        return pure8(new VObject(empty3));
      });
    };
  };
};
var pluckH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(av) {
    return function(keyv) {
      return bind9(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return pure8(new VArray(map14(extractPath(key))(av.value0)));
        }
        ;
        return pure8(new VArray([]));
      });
    };
  };
};
var escJsonH = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var jsonText1 = jsonText(dictMonadThrow);
  return function(v) {
    return function(args) {
      return map32(function($811) {
        return VSafe.create(escapeHtml($811));
      })(jsonText1("escapeJson")(args));
    };
  };
};
var escHtml = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure8 = pure(Monad0.Applicative0());
  var map32 = map(Monad0.Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    if (v instanceof VSafe) {
      return pure8(new VSafe(v.value0));
    }
    ;
    return map32(function($812) {
      return VSafe.create(escapeHtml($812));
    })(stringifyM1(v));
  };
};
var eq$prime = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(a) {
    return function(b) {
      return pure8(new VBool(eq4(a)(b)));
    };
  };
};
var endsWithH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
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
          throw new Error("Failed pattern match at Kernel.Prelude (line 781, column 26 - line 783, column 21): " + [v.constructor.name]);
        };
      };
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure8(new VBool(isJustSuffix(x)(s)));
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
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
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
              return pure8(new VObject(acc));
            }
            ;
            if (v1 instanceof Just && v1.value0.head instanceof VString) {
              var v2 = uncons(v1.value0.tail);
              if (v2 instanceof Just) {
                $tco_var_as = v2.value0.tail;
                $copy_acc = insert3(v1.value0.head.value0)(v2.value0.head)(acc);
                return;
              }
              ;
              if (v2 instanceof Nothing) {
                $tco_done = true;
                return throwError3(new ArityError("dict: odd number of arguments"));
              }
              ;
              throw new Error("Failed pattern match at Kernel.Prelude (line 1424, column 39 - line 1426, column 73): " + [v2.constructor.name]);
            }
            ;
            if (v1 instanceof Just) {
              $tco_done = true;
              return throwError3(new $$TypeError("dict: keys must be strings"));
            }
            ;
            throw new Error("Failed pattern match at Kernel.Prelude (line 1422, column 18 - line 1427, column 66): " + [v1.constructor.name]);
          }
          ;
          while (!$tco_done) {
            $tco_result = $tco_loop($tco_var_as, $copy_acc);
          }
          ;
          return $tco_result;
        };
      };
      return build(args)(empty3);
    };
  };
};
var dateH = function(dictMonadThrow) {
  return passthrough(dictMonadThrow)("date");
};
var countH = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(v) {
    if (v instanceof VArray) {
      return pure8(new VNumber(toNumber(length(v.value0))));
    }
    ;
    if (v instanceof VObject) {
      return pure8(new VNumber(toNumber(size2(v.value0))));
    }
    ;
    return pure8(new VNumber(0));
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
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(av) {
    return function(keyv) {
      var keyOrdering = function(key) {
        return function(a) {
          return function(b) {
            return fromMaybe(EQ.value)(compareValues(extractPath(key)(a))(extractPath(key)(b)));
          };
        };
      };
      return bind9(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return pure8(new VArray(sortBy(function(a) {
            return function(b) {
              return keyOrdering(key)(a)(b);
            };
          })(av.value0)));
        }
        ;
        return pure8(new VArray([]));
      });
    };
  };
};
var coalesceH = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(v) {
    return function(args) {
      var notNull = function(v1) {
        if (v1 instanceof VNull) {
          return false;
        }
        ;
        return true;
      };
      return pure8(fromMaybe(VNull.value)(find2(notNull)(args)));
    };
  };
};
var cmp = function(dictApplicative) {
  var pure8 = pure(dictApplicative);
  return function(ok) {
    return function(a) {
      return function(b) {
        return pure8(new VBool(maybe(false)(ok)(compareValues(a)(b))));
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
    throw new Error("Failed pattern match at Kernel.Prelude (line 745, column 1 - line 745, column 32): " + [len.constructor.name, i.constructor.name]);
  };
};
var checkIfClauses = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(clauses) {
    var v = uncons(clauses);
    if (v instanceof Nothing) {
      return pure8(unit);
    }
    ;
    if (v instanceof Just) {
      if (v.value0.head.name === "else") {
        if ($$null(v.value0.tail)) {
          return pure8(unit);
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
    throw new Error("Failed pattern match at Kernel.Prelude (line 1155, column 26 - line 1165, column 82): " + [v.constructor.name]);
  };
};
var ifH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var pure8 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  var discard1 = discard2(Bind1);
  var checkIfClauses1 = checkIfClauses(dictMonadThrow);
  var renderSafe1 = renderSafe(dictMonadThrow);
  var pickClause1 = pickClause(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return bind9((function() {
        if (args.length === 1) {
          return pure8(refTruthy(ctl.env)(args[0]));
        }
        ;
        if (args.length === 2) {
          return pure8(truthyWith(refTruthy(ctl.env))(args[1])(args[0]));
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
var capitalizeStr = function(s) {
  var v = uncons2(s);
  if (v instanceof Nothing) {
    return s;
  }
  ;
  if (v instanceof Just) {
    return toUpper(singleton6(v.value0.head)) + v.value0.tail;
  }
  ;
  throw new Error("Failed pattern match at Kernel.Prelude (line 671, column 19 - line 673, column 68): " + [v.constructor.name]);
};
var buildContextChain = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var pure8 = pure(Monad0.Applicative0());
  return function(ctl) {
    return bind9((function() {
      var v = lookupOperation("@parentchain")(ctl.env);
      if (v instanceof Just) {
        return v.value0(ctl)([]);
      }
      ;
      if (v instanceof Nothing) {
        return pure8(VNull.value);
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1264, column 21 - line 1266, column 26): " + [v.constructor.name]);
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
        return empty3;
      })();
      return pure8(new VObject(union3(fromFoldable7([new Tuple("this", enclosingCtx), new Tuple("parent", enclosingChain), new Tuple("root", rootCtx)]))(ctxFields)));
    });
  };
};
var iterate2 = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var Applicative0 = Monad0.Applicative0();
  var pure8 = pure(Applicative0);
  var buildContextChain1 = buildContextChain(dictMonadThrow);
  var constOperation3 = constOperation(Applicative0);
  var map32 = map(Bind1.Apply0().Functor0());
  var traverse13 = traverse4(Applicative0);
  return function(ctl) {
    return function(names) {
      return function(items) {
        return bind9((function() {
          var v = lookupOperation("loop")(ctl.env);
          if (v instanceof Just) {
            return v.value0(ctl)([]);
          }
          ;
          if (v instanceof Nothing) {
            return pure8(VNull.value);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Prelude (line 1297, column 20 - line 1299, column 26): " + [v.constructor.name]);
        })())(function(enclosingLoop) {
          return bind9(buildContextChain1(ctl))(function(parentChain) {
            var n = length(items);
            var metaFields = function(i) {
              return function(val) {
                return function(key) {
                  return [new Tuple("this", val), new Tuple("index0", new VNumber(toNumber(i))), new Tuple("index1", new VNumber(toNumber(i + 1 | 0))), new Tuple("rindex0", new VNumber(toNumber((n - 1 | 0) - i | 0))), new Tuple("rindex1", new VNumber(toNumber(n - i | 0))), new Tuple("first", new VBool(i === 0)), new Tuple("last", new VBool(i === (n - 1 | 0))), new Tuple("length", new VNumber(toNumber(n))), new Tuple("key", key)];
                };
              };
            };
            var rootLoop = function(i) {
              return function(val) {
                return function(key) {
                  if (enclosingLoop instanceof VObject) {
                    return fromMaybe(new VObject(fromFoldable7(metaFields(i)(val)(key))))(lookup5("root")(enclosingLoop.value0));
                  }
                  ;
                  return new VObject(fromFoldable7(metaFields(i)(val)(key)));
                };
              };
            };
            var main = mainBody(ctl);
            var loopObject = function(i) {
              return function(val) {
                return function(key) {
                  return new VObject(fromFoldable7(append12(metaFields(i)(val)(key))([new Tuple("parent", enclosingLoop), new Tuple("root", rootLoop(i)(val)(key))])));
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
                    throw new Error("Failed pattern match at Kernel.Prelude (line 1342, column 12 - line 1344, column 24): " + [ctl.loopLabel.constructor.name]);
                  })());
                };
              };
            };
            var binds = function(val) {
              return function(idx) {
                return zipWith(function(nm) {
                  return function(v) {
                    return new Tuple(nm, constOperation3(v));
                  };
                })(names)([val, idx]);
              };
            };
            var renderItem = function(i) {
              return function(v) {
                var frame = fromFoldable7(append12([new Tuple("this", constOperation3(v.val)), new Tuple("index", constOperation3(new VNumber(toNumber(i)))), new Tuple("key", constOperation3(v.key)), new Tuple("first", constOperation3(new VBool(i === 0))), new Tuple("last", constOperation3(new VBool(i === (n - 1 | 0)))), new Tuple("parent", constOperation3(refContext(ctl.env))), new Tuple("index0", constOperation3(new VNumber(toNumber(i)))), new Tuple("index1", constOperation3(new VNumber(toNumber(i + 1 | 0)))), new Tuple("rindex0", constOperation3(new VNumber(toNumber((n - 1 | 0) - i | 0)))), new Tuple("rindex1", constOperation3(new VNumber(toNumber(n - i | 0)))), new Tuple("length", constOperation3(new VNumber(toNumber(n))))])(append12(parentData(ctl))(append12(binds(v.val)(v.idx))(loopBinds(i)(v.val)(v.key)))));
                return ctl.render(pushFrame(frame)(v.val)(ctl.env))(main);
              };
            };
            return map32((function() {
              var $813 = joinWith("");
              return function($814) {
                return VSafe.create($813($814));
              };
            })())(traverse13(identity9)(mapWithIndex2(renderItem)(items)));
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
  var pure8 = pure(dictApplicative);
  return function(quant) {
    return function(ctl) {
      return function(args) {
        return pure8(new VBool(quant(refTruthy(ctl.env))(args)));
      };
    };
  };
};
var bodyStart = function(s) {
  var body = trim(s);
  var $729 = body === "";
  if ($729) {
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
  throw new Error("Failed pattern match at Kernel.Prelude (line 687, column 16 - line 689, column 68): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at Kernel.Prelude (line 682, column 18 - line 684, column 31): " + [v.constructor.name]);
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
          var $738 = $$null(v.value0.head.value0);
          if ($738) {
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
          var pairs = toUnfoldable6(v.value0.head.value0);
          var $740 = $$null(pairs);
          if ($740) {
            return renderElse1(ctl);
          }
          ;
          return iterate1(ctl)(names)(map14(function(v1) {
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 1210, column 18 - line 1231, column 84): " + [v.constructor.name]);
    };
  };
};
var withH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var buildContextChain1 = buildContextChain(dictMonadThrow);
  var constOperation3 = constOperation(Monad0.Applicative0());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var renderElse1 = renderElse(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just) {
        var $749 = refTruthy(ctl.env)(v.value0.head);
        if ($749) {
          return bind9(buildContextChain1(ctl))(function(parentChain) {
            var binds = zipWith(function(nm) {
              return function(val) {
                return new Tuple(nm, constOperation3(val));
              };
            })(bindingNames(v.value0.tail))([v.value0.head]);
            var frame = fromFoldable7(append12([new Tuple("parent", constOperation3(refContext(ctl.env))), new Tuple("@parentchain", constOperation3(parentChain))])(append12(parentData(ctl))(binds)));
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 1376, column 18 - line 1393, column 84): " + [v.constructor.name]);
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
        throw new Error("Failed pattern match at Kernel.Prelude (line 1408, column 1 - line 1408, column 77): " + [name2.constructor.name, ctl.constructor.name, args.constructor.name]);
      };
    };
  };
};
var blockHelperMissing = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var sectionOp1 = sectionOp(dictMonadThrow);
  return function(v) {
    return function(name2) {
      return pure8(sectionOp1(name2));
    };
  };
};
var asNum = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    if (v instanceof VNumber) {
      return pure8(v.value0);
    }
    ;
    return throwError3(new $$TypeError("arithmetic expects a number"));
  };
};
var numUnary = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var asNum1 = asNum(dictMonadThrow);
  return function(f) {
    return function(v) {
      return map32(function($815) {
        return VNumber.create(f($815));
      })(asNum1(v));
    };
  };
};
var relativeH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var liftEither2 = liftEither(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var v1 = index(args)(1);
      var v2 = index(args)(0);
      if (v2 instanceof Just && v1 instanceof Just) {
        return bind9(asNum1(v2.value0))(function(v3) {
          return bind9(liftEither2(stringify2(v1.value0)))(function(unit2) {
            return bind9(liftEither2(stringify2(new VNumber(abs(v3)))))(function(magStr) {
              var punit = (function() {
                var $762 = abs(v3) === 1;
                if ($762) {
                  return unit2;
                }
                ;
                return unit2 + "s";
              })();
              return pure8(new VString((function() {
                var $763 = v3 < 0;
                if ($763) {
                  return magStr + (" " + (punit + " ago"));
                }
                ;
                var $764 = v3 > 0;
                if ($764) {
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
  };
};
var selectPluralH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(v) {
    return function(args) {
      var v1 = head(args);
      if (v1 instanceof Nothing) {
        return throwError3(new ArityError("selectPlural: expected at least 1 argument(s), got 0"));
      }
      ;
      if (v1 instanceof Just) {
        return bind9(asNum1(v1.value0))(function(n) {
          return pure8(new VString((function() {
            var $768 = n === 1;
            if ($768) {
              return "one";
            }
            ;
            return "other";
          })()));
        });
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1037, column 24 - line 1041, column 57): " + [v1.constructor.name]);
    };
  };
};
var asInt = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var asNum1 = asNum(dictMonadThrow);
  return function(v) {
    return map32(function($816) {
      return round2(trunc($816));
    })(asNum1(v));
  };
};
var atH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var asInt1 = asInt(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(av) {
    return function(iv) {
      return bind9(asInt1(iv))(function(i) {
        if (av instanceof VArray) {
          var idx = (function() {
            var $771 = i < 0;
            if ($771) {
              return length(av.value0) + i | 0;
            }
            ;
            return i;
          })();
          return pure8(fromMaybe(VNull.value)(index(av.value0)(idx)));
        }
        ;
        return pure8(VNull.value);
      });
    };
  };
};
var sliceH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var slice1 = function(sv) {
        return function(startv) {
          return function(mEndv) {
            return bind9(stringifyM1(sv))(function(s) {
              return bind9(asInt1(startv))(function(start) {
                var len = length2(s);
                return bind9((function() {
                  if (mEndv instanceof Nothing) {
                    return pure8(len);
                  }
                  ;
                  if (mEndv instanceof Just) {
                    return asInt1(mEndv.value0);
                  }
                  ;
                  throw new Error("Failed pattern match at Kernel.Prelude (line 735, column 12 - line 737, column 30): " + [mEndv.constructor.name]);
                })())(function(end) {
                  var lo = clampIndex(len)(start);
                  var hi = clampIndex(len)(end);
                  return pure8(new VString((function() {
                    var $775 = lo >= hi;
                    if ($775) {
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
  var bind9 = bind(Monad0.Bind1());
  var asInt1 = asInt(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(f) {
    return function(av) {
      return function(nv) {
        return bind9(asInt1(nv))(function(n) {
          if (av instanceof VArray) {
            return pure8(new VArray(f(max3(0)(n))(av.value0)));
          }
          ;
          return pure8(new VArray([]));
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
  var bind9 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(nv) {
    return function(dv) {
      return bind9(asNum1(nv))(function(n) {
        return bind9(asInt1(dv))(function(d) {
          return pure8(new VString(toStringWith(fixed(d))(n)));
        });
      });
    };
  };
};
var truncateH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var truncate1 = function(sv) {
        return function(nv) {
          return function(suf) {
            return bind9(stringifyM1(sv))(function(s) {
              return bind9(asInt1(nv))(function(n) {
                return pure8(new VString((function() {
                  var $784 = length2(s) > n;
                  if ($784) {
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
        return bind9(stringifyM1(args[2]))(function(suf) {
          return truncate1(args[0])(args[1])(suf);
        });
      }
      ;
      return throwError3(new ArityError("truncate: expected 2 or 3 arguments, got " + show6(length(args))));
    };
  };
};
var arith = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var asNum1 = asNum(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(op) {
    return function(a) {
      return function(b) {
        return bind9(asNum1(a))(function(x) {
          return bind9(asNum1(b))(function(y) {
            return pure8(new VNumber(op(x)(y)));
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
        throw new Error("Failed pattern match at Kernel.Prelude (line 1431, column 40 - line 1433, column 47): " + [v1.constructor.name]);
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
  var pure8 = pure(Applicative0);
  var unary2 = unary(dictMonadThrow);
  var binary2 = binary(dictMonadThrow);
  var ne$prime1 = ne$prime(Applicative0);
  var cmp1 = cmp(Applicative0);
  var boolH1 = boolH(Applicative0);
  var arith1 = arith(dictMonadThrow);
  return [gen("this")("The current context.")(false)(new Exactly(0))(thisH(Applicative0)), gen("lookup")("Indexes a value by each key or index in turn, returning null at the first miss.")(false)(new AtLeast(1))(lookupH(dictMonadThrow)), gen("t")("Translates a message key via the host's i18n callback; returns the key unchanged when no translator is registered (ADR-029 fallback-and-flag).")(false)(new AtLeast(1))(translateH(dictMonadThrow)), gen("number")("Formats a number for the host's locale (Intl.NumberFormat); returns the number's plain text when no host formatter is registered (ADR-029).")(false)(new AtLeast(1))(numberH(dictMonadThrow)), gen("date")("Formats a date value for the host's locale (Intl.DateTimeFormat); returns the value's plain text when no host formatter is registered (ADR-029).")(false)(new AtLeast(1))(dateH(dictMonadThrow)), gen("selectPlural")("Returns the CLDR plural category for a number in the host's locale; falls back to the English one/other rule when no host rule is registered (ADR-029).")(false)(new AtLeast(1))(selectPluralH(dictMonadThrow)), gen("relative")("Formats a relative time (value, unit) for the host's locale (Intl.RelativeTimeFormat); falls back to a plain English phrasing when no host formatter is registered (ADR-029).")(false)(new AtLeast(2))(relativeH(dictMonadThrow)), valDef1("true")("The boolean literal true.")(nullary2(pure8(new VBool(true)))), valDef1("false")("The boolean literal false.")(nullary2(pure8(new VBool(false)))), valDef1("null")("The null literal.")(nullary2(pure8(VNull.value))), valDef1("escapeHtml")("HTML-escapes its argument and marks it safe; idempotent on already-safe values.")(unary2(escHtml(dictMonadThrow))), valDef1("safe")("Marks its argument as safe (trusted) markup, without escaping.")(unary2(safe2(dictMonadThrow))), gen("json")("Serializes its argument as JSON text (optionally pretty-printed).")(false)(new Between(1, 2))(jsonH(dictMonadThrow)), gen("escapeJson")("Serializes its argument as JSON and HTML-escapes it, for safe embedding in HTML.")(false)(new Between(1, 2))(escJsonH(dictMonadThrow)), gen("raw")("A raw block that returns its body verbatim, untouched by the engine.")(true)(AnyArity.value)(rawH(dictMonadThrow)), gen("if")("Renders its body when the condition is truthy, else the {{elif}}/{{else}} clauses.")(true)(new Between(1, 2))(ifH(dictMonadThrow)), gen("unless")("Renders its body when the condition is falsy \u2014 the inverse of if.")(true)(new Between(1, 2))(unlessH(dictMonadThrow)), gen("each")("Iterates an array or object, installing the loop's scoped variables per item.")(true)(new AtLeast(1))(eachH(dictMonadThrow)), gen("with")("Shifts the context to its argument for the body (else the {{else}} clause).")(true)(new AtLeast(1))(withH(dictMonadThrow)), valDef1("else")("A clause separator the enclosing block splits on; renders nothing on its own.")(nullary2(pure8(new VSafe("")))), gen("elif")("An else-if clause the enclosing if evaluates; renders nothing on its own.")(false)(new Between(1, 2))(function(v) {
    return function(v1) {
      return pure8(new VSafe(""));
    };
  }), gen("dict")("Builds an object from alternating key/value arguments (the hash target).")(false)(AnyArity.value)(dictH(dictMonadThrow)), gen("apply")("Calls a helper named by a string argument with the remaining arguments.")(true)(new AtLeast(1))(applyH(dictMonadThrow)), gen("partial")("Renders a registered partial with the given context (the block body is the fallback).")(false)(new Between(2, 3))(partialH(dictMonadThrow)), gen("inline")("Defines a partial from its body, hoisted before rendering; emits nothing.")(true)(new AtLeast(1))(inlineH(Applicative0)), valDef1("eq")("True when its two arguments are equal.")(binary2(eq$prime(Applicative0))), valDef1("ne")("True when its two arguments are not equal.")(binary2(ne$prime1)), valDef1("lt")("True when the first argument is less than the second.")(binary2(cmp1(function(v) {
    return eq42(v)(LT.value);
  }))), valDef1("gt")("True when the first argument is greater than the second.")(binary2(cmp1(function(v) {
    return eq42(v)(GT.value);
  }))), valDef1("lte")("True when the first argument is less than or equal to the second.")(binary2(cmp1(function(v) {
    return notEq12(v)(GT.value);
  }))), valDef1("gte")("True when the first argument is greater than or equal to the second.")(binary2(cmp1(function(v) {
    return notEq12(v)(LT.value);
  }))), withSynonym("ne")(valDef1("isnt")("True when its two arguments are not equal.")(binary2(ne$prime1))), gen("not")("Logical negation of its argument's truthiness.")(false)(new Exactly(1))(notH(dictMonadThrow)), gen("and")("True when every argument is truthy.")(false)(AnyArity.value)(boolH1(all2)), gen("or")("True when any argument is truthy.")(false)(AnyArity.value)(boolH1(any2)), valDef1("add")("Adds two numbers \u2014 the `+` operator's helper.")(binary2(arith1(add1))), valDef1("subtract")("Subtracts the second number from the first \u2014 the `-` operator's helper.")(binary2(arith1(sub2))), valDef1("multiply")("Multiplies two numbers \u2014 the `*` operator's helper.")(binary2(arith1(mul2))), valDef1("divide")("Divides the first number by the second \u2014 the `/` operator's helper.")(binary2(arith1(div3))), valDef1("modulo")("The remainder of dividing the first number by the second \u2014 the `%` operator's helper.")(binary2(arith1(jsMod))), withAlias("add")(valDef1("plus")("Adds two numbers.")(binary2(arith1(add1)))), withAlias("subtract")(valDef1("minus")("Subtracts the second number from the first.")(binary2(arith1(sub2)))), withAlias("multiply")(valDef1("times")("Multiplies two numbers.")(binary2(arith1(mul2)))), gen("coalesce")("Returns the first non-null argument \u2014 the `??` operator's helper.")(false)(new AtLeast(1))(coalesceH(dictMonadThrow)), valDef1("log")("Logs its arguments to the host and returns null.")(atLeast(dictMonadThrow)(1)($$const(pure8(VNull.value))))];
};
var appendH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure8 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure8(new VString(s + x));
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
  return [valDef1("lowercase")("Lowercases its argument.")(unary2(strUnary1(toLower))), valDef1("uppercase")("Uppercases its argument.")(unary2(strUnary1(toUpper))), valDef1("capitalize")("Uppercases the first character of its argument.")(unary2(strUnary1(capitalizeStr))), valDef1("trim")("Removes leading and trailing whitespace.")(unary2(strUnary1(trim))), valDef1("trimStart")("Removes leading whitespace.")(unary2(strUnary1(trimStartStr))), valDef1("trimEnd")("Removes trailing whitespace.")(unary2(strUnary1(trimEndStr))), valDef1("split")("Splits a string into an array on a separator.")(binary2(splitH(dictMonadThrow))), gen("replace")("Replaces every occurrence of a substring with another.")(false)(new Exactly(3))(replaceH(dictMonadThrow)), gen("slice")("Returns a substring from a start index to an optional end index.")(false)(new Between(2, 3))(sliceH(dictMonadThrow)), valDef1("includes")("True when the subject string or array contains the given value.")(binary2(includesH(dictMonadThrow))), valDef1("startsWith")("True when the string starts with the given prefix.")(binary2(startsWithH(dictMonadThrow))), valDef1("endsWith")("True when the string ends with the given suffix.")(binary2(endsWithH(dictMonadThrow))), gen("truncate")("Shortens a string to a maximum length, appending an optional ellipsis.")(false)(new Between(2, 3))(truncateH(dictMonadThrow)), valDef1("append")("Appends the second string to the first.")(binary2(appendH(dictMonadThrow))), valDef1("prepend")("Prepends the second string to the first.")(binary2(prependH(dictMonadThrow))), withAlias("lowercase")(valDef1("downcase")("Lowercases its argument.")(unary2(strUnary1(toLower)))), withAlias("uppercase")(valDef1("upcase")("Uppercases its argument.")(unary2(strUnary1(toUpper)))), valDef1("abs")("The absolute value of a number.")(unary2(numUnary1(abs))), valDef1("floor")("Rounds a number down to the nearest integer.")(unary2(numUnary1(floor))), valDef1("ceil")("Rounds a number up to the nearest integer.")(unary2(numUnary1(ceil))), valDef1("round")("Rounds a number to the nearest integer.")(unary2(numUnary1(round))), valDef1("toFixed")("Formats a number with a fixed number of decimal places.")(binary2(toFixedH(dictMonadThrow))), valDef1("toInt")("Parses its argument as an integer.")(unary2(toIntH(dictMonadThrow))), valDef1("toFloat")("Parses its argument as a floating-point number.")(unary2(toFloatH(dictMonadThrow))), valDef1("join")("Joins an array into a string with a separator.")(binary2(joinH(dictMonadThrow))), valDef1("count")("The number of items in an array (or characters in a string).")(unary2(countH1)), withSynonym("count")(valDef1("size")("The number of items in an array (or characters in a string).")(unary2(countH1))), valDef1("at")("The element at an index (negative counts from the end).")(binary2(atH(dictMonadThrow))), valDef1("take")("The first n elements of an array.")(binary2(takeH(dictMonadThrow))), valDef1("takeRight")("The last n elements of an array.")(binary2(takeRightH(dictMonadThrow))), valDef1("reverse")("Reverses an array or string.")(unary2(reverseH(dictMonadThrow))), valDef1("unique")("The array with duplicate elements removed.")(unary2(uniqueH(Applicative0))), valDef1("sortBy")("Sorts an array of objects by a key.")(binary2(sortByH(dictMonadThrow))), valDef1("pluck")("Extracts a key's value from each object in an array.")(binary2(pluckH(dictMonadThrow))), valDef1("groupBy")("Groups an array of objects into an object keyed by a field.")(binary2(groupByH(dictMonadThrow)))];
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
  return map14(function(d) {
    return new Tuple(d.name, d.run);
  })(operationDefs(dictMonadThrow));
};
var preludeAliases = /* @__PURE__ */ mapMaybe(function(d) {
  return map15(Tuple.create(d.name))(d.alias);
})(operationDefs1);

// output/Kernel.Render/index.js
var show7 = /* @__PURE__ */ show(showError);
var preludeEnv = function(dictMonadThrow) {
  var prelude2 = prelude(dictMonadThrow);
  var constOperation3 = constOperation(dictMonadThrow.Monad0().Applicative0());
  return function(dat) {
    return registerAll(prelude2)(register("root")(constOperation3(dat))(emptyEnv(dat)));
  };
};
var runResolvedUsing = function(dictMonadThrow) {
  var runTemplate4 = runTemplate(dictMonadThrow.Monad0());
  var preludeEnv1 = preludeEnv(dictMonadThrow);
  return function(toEngine) {
    return function(_directives) {
      return function(setup) {
        return function(nodes) {
          return function(dat) {
            return runTemplate4(toEngine(setup(preludeEnv1(dat))))(nodes);
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
  return runResolvedUsing(dictMonadThrow)(refEngineWith(dictMonadThrow)(blockHelperMissing(dictMonadThrow)));
};
var formatError = function(src) {
  return function(v) {
    if (v instanceof ParseFailure) {
      return renderParseErrorAt(src)(v.value0);
    }
    ;
    return show7(v);
  };
};

// output/Kernel.Analyse/index.js
var mapFlipped2 = /* @__PURE__ */ mapFlipped(functorMaybe);
var nub2 = /* @__PURE__ */ nub(ordString);
var append13 = /* @__PURE__ */ append(semigroupArray);
var map16 = /* @__PURE__ */ map(functorArray);
var show8 = /* @__PURE__ */ show(showNumber);
var show1 = /* @__PURE__ */ show(showBoolean);
var show22 = /* @__PURE__ */ show(showInt);
var monadThrowWriterT2 = /* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither);
var discard3 = /* @__PURE__ */ discard(discardUnit)(/* @__PURE__ */ bindWriterT(semigroupArray)(bindEither));
var for_2 = /* @__PURE__ */ for_(/* @__PURE__ */ applicativeWriterT(monoidArray)(applicativeEither))(foldableArray);
var tell2 = /* @__PURE__ */ tell(/* @__PURE__ */ monadTellWriterT(monoidArray)(monadEither));
var lookup6 = /* @__PURE__ */ lookup3(ordString);
var preludeEnv2 = /* @__PURE__ */ preludeEnv(monadThrowWriterT2);
var mapFlipped1 = /* @__PURE__ */ mapFlipped(functorEither);
var runTemplate2 = /* @__PURE__ */ runTemplate(/* @__PURE__ */ monadWriterT(monoidArray)(monadEither));
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
  var $58 = body !== "" && all2(pathChar)(toCharArray(body));
  if ($58) {
    return new Just(body);
  }
  ;
  return Nothing.value;
};
var namedRules = /* @__PURE__ */ (function() {
  return [new Tuple("handlebars", handlebars), new Tuple("mustache-spec", mustache), new Tuple("minimal", minimal), new Tuple("presence", presence)];
})();
var isFinding = function(d) {
  return !$$null(d.diverges);
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
      throw new Error("Failed pattern match at Kernel.Analyse (line 285, column 16 - line 287, column 19): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at Kernel.Analyse (line 288, column 14 - line 290, column 17): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at Kernel.Analyse (line 280, column 20 - line 283, column 98): " + [v.constructor.name]);
    };
    var computed = nub2(mapMaybe(computedNote)(flagged));
    return joinWith("\n")(append13(["(* Truthiness cleanup scaffold (ADR-022) \u2014 REVIEW each rule before applying. *)", "(* Each path resolved to an engine-ambiguous value in a condition. *)"])(append13((function() {
      var $70 = $$null(transforms);
      if ($70) {
        return ["(* no bare-path findings to normalise *)"];
      }
      ;
      return transforms;
    })())((function() {
      var $71 = $$null(computed);
      if ($71) {
        return [];
      }
      ;
      return append13([""])(computed);
    })())));
  };
};
var fixFor = function(v) {
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
var divergence = function(v) {
  return function(here) {
    return filter(function(t) {
      return snd(t) !== here;
    })(map16(function(t) {
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
      var $80 = v.value0 === 0;
      if ($80) {
        return "0";
      }
      ;
      return show8(v.value0);
    })() + "`");
  }
  ;
  if (v instanceof VBool) {
    return "`" + (show1(v.value0) + "`");
  }
  ;
  if (v instanceof VNull) {
    return "`null`";
  }
  ;
  if (v instanceof VArray) {
    var $83 = $$null(v.value0);
    if ($83) {
      return "an empty array `[]`";
    }
    ;
    return "a non-empty array";
  }
  ;
  if (v instanceof VObject) {
    var $85 = isEmpty(v.value0);
    if ($85) {
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
  throw new Error("Failed pattern match at Kernel.Analyse (line 230, column 12 - line 238, column 29): " + [v.constructor.name]);
};
var findings = function(src) {
  var toFinding = function(d) {
    var tagTxt = trim(spanText(src)(d.span));
    var lc = lineColumn(src)(d.span.start);
    return {
      line: lc.line,
      column: lc.column,
      tag: tagTxt,
      value: describe(d.value),
      flips: map16(fst)(d.diverges),
      fix: fixFor(d.value),
      path: (function() {
        var v = recoverPath(tagTxt);
        if (v instanceof Just) {
          return v.value0;
        }
        ;
        if (v instanceof Nothing) {
          return "";
        }
        ;
        throw new Error("Failed pattern match at Kernel.Analyse (line 122, column 15 - line 124, column 24): " + [v.constructor.name]);
      })()
    };
  };
  var $104 = map16(toFinding);
  var $105 = filter(isFinding);
  return function($106) {
    return $104($105($106));
  };
};
var reportMarkdown = function(src) {
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
    var pathNote = function(v) {
      if (v instanceof Just) {
        return "  \xB7  data path: `" + (v.value0 + "`");
      }
      ;
      if (v instanceof Nothing) {
        return "";
      }
      ;
      throw new Error("Failed pattern match at Kernel.Analyse (line 223, column 14 - line 225, column 18): " + [v.constructor.name]);
    };
    var loc = function(d) {
      var lc = lineColumn(src)(d.span.start);
      return "line " + show22(lc.line);
    };
    var flagged = filter(isFinding)(decisions);
    var findingSection = function(d) {
      return joinWith("\n")(["## \u26A0 " + (loc(d) + (" \u2014 `" + (tag(d) + ("` tested " + describe(d.value))))), "Under `handlebars` (engine) this is **" + (verdict(d.truthyHere) + ("**; it flips under " + (joinWith(", ")(map16(function(t) {
        return "`" + (fst(t) + "`");
      })(d.diverges)) + "."))), "**Fix** \xB7 " + (fixFor(d.value) + pathNote(recoverPath(tag(d)))), ""]);
    };
    var cleanLine = function(d) {
      return "* \u2713 " + (loc(d) + (" \u2014 `" + (tag(d) + ("` tested " + (describe(d.value) + " (agrees everywhere)")))));
    };
    var clean = filter(function($107) {
      return !isFinding($107);
    })(decisions);
    return joinWith("\n")(append13(["# Truthiness analysis", "Engine rule: `handlebars` \xB7 " + (show22(length(decisions)) + (" condition(s) evaluated, **" + (show22(length(flagged)) + " portability finding(s)**"))), "", '_The engine `handlebars` rule is also `mustache.js`\' (`0`/`""` falsy), so a finding\'s `flips under` names the engines that branch the *other* way \u2014 `mustache-spec` is the language-agnostic Mustache/Ruby reading (`0`/`""` truthy), not `mustache.js`._', ""])(append13((function() {
      var $93 = $$null(flagged);
      if ($93) {
        return ["_No portability findings \u2014 every condition agrees across engines for this data._", ""];
      }
      ;
      return map16(findingSection)(flagged);
    })())((function() {
      var $94 = $$null(clean);
      if ($94) {
        return [];
      }
      ;
      return append13(["## Portable conditions"])(map16(cleanLine)(clean));
    })())));
  };
};
var analysisWrappers = /* @__PURE__ */ (function() {
  var preludeMap = fromFoldable3(ordString)(foldableArray)(prelude(monadThrowWriterT2));
  var decisionFor = function(name2) {
    return function(ctl) {
      return function(v) {
        var here = refTruthy(ctl.env)(v);
        return {
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
  var analysed = function(name2) {
    return function(variadic) {
      return function(orig) {
        return function(ctl) {
          return function(args) {
            var tested = (function() {
              if (variadic) {
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
    throw new Error("Failed pattern match at Kernel.Analyse (line 138, column 32 - line 140, column 65): " + [v1.constructor.name]);
  };
  return mapMaybe(wrap3)(conds);
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

// output/Kernel.Hoist/index.js
var union4 = /* @__PURE__ */ union(ordString);
var insert4 = /* @__PURE__ */ insert(ordString);
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
            partials: union4(acc.partials)(inner2.partials),
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
            partials: insert4($20.value0)(inner.template)(union4(acc.partials)(inner.partials))
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
    partials: empty3,
    template: []
  })(nodes);
};

// output/Kernel.Lower/index.js
var RText = /* @__PURE__ */ (function() {
  function RText2(value0) {
    this.value0 = value0;
  }
  ;
  RText2.create = function(value0) {
    return new RText2(value0);
  };
  return RText2;
})();
var ROut = /* @__PURE__ */ (function() {
  function ROut2(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  ROut2.create = function(value0) {
    return function(value1) {
      return new ROut2(value0, value1);
    };
  };
  return ROut2;
})();
var RIf = /* @__PURE__ */ (function() {
  function RIf2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RIf2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RIf2(value0, value1, value2);
      };
    };
  };
  return RIf2;
})();
var RUnless = /* @__PURE__ */ (function() {
  function RUnless2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RUnless2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RUnless2(value0, value1, value2);
      };
    };
  };
  return RUnless2;
})();
var REach = /* @__PURE__ */ (function() {
  function REach2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  REach2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new REach2(value0, value1, value2);
      };
    };
  };
  return REach2;
})();
var RWith = /* @__PURE__ */ (function() {
  function RWith2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RWith2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RWith2(value0, value1, value2);
      };
    };
  };
  return RWith2;
})();
var RCall = /* @__PURE__ */ (function() {
  function RCall2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RCall2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RCall2(value0, value1, value2);
      };
    };
  };
  return RCall2;
})();
var RSep2 = /* @__PURE__ */ (function() {
  function RSep3(value0, value1) {
    this.value0 = value0;
    this.value1 = value1;
  }
  ;
  RSep3.create = function(value0) {
    return function(value1) {
      return new RSep3(value0, value1);
    };
  };
  return RSep3;
})();
var RRaw2 = /* @__PURE__ */ (function() {
  function RRaw3(value0) {
    this.value0 = value0;
  }
  ;
  RRaw3.create = function(value0) {
    return new RRaw3(value0);
  };
  return RRaw3;
})();
var lower = /* @__PURE__ */ (function() {
  var lowerIf = function(cond) {
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
              return [new RIf(v2["value0"]["head"]["args"][0], recurse(v2.value0.head.body), foldClauses(v2.value0.tail))];
            }
            ;
            return recurse(v2.value0.head.body);
          }
          ;
          throw new Error("Failed pattern match at Kernel.Lower (line 108, column 22 - line 112, column 32): " + [v2.constructor.name]);
        };
        var v = splitClauses(children);
        return new RIf(cond, recurse(v.before), foldClauses(v.clauses));
      };
    };
  };
  var lowerBlock = function(name2) {
    return function(args) {
      return function(children) {
        return function(recurse) {
          var s = splitClause("else")(children);
          var elseBranch = recurse(fromMaybe([])(s.clause));
          var before = recurse(s.before);
          var v = head(args);
          if (v instanceof Just && name2 === "if") {
            return lowerIf(v.value0)(children)(recurse);
          }
          ;
          if (v instanceof Just) {
            if (name2 === "unless") {
              return new RUnless(v.value0, before, elseBranch);
            }
            ;
            if (name2 === "each") {
              return new REach(v.value0, before, elseBranch);
            }
            ;
            if (name2 === "with") {
              return new RWith(v.value0, before, elseBranch);
            }
            ;
          }
          ;
          return new RCall(name2, args, recurse(children));
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
    content: function(s) {
      return [new RText(s)];
    },
    output: function(e) {
      return [uncurry(ROut.create)(escaping(e))];
    },
    raw: function(v) {
      return function(v1) {
        return function(body) {
          return [new RRaw2(body)];
        };
      };
    },
    sep: function(name2) {
      return function(args) {
        return [new RSep2(name2, args)];
      };
    },
    block: function(b) {
      return [lowerBlock(b.name)(b.args)(b.children)(b.recurse)];
    },
    nodeError: function(v) {
      return function(v1) {
        return [];
      };
    },
    concat: join(bindArray)
  });
})();

// output/FullBars/index.js
var pure3 = /* @__PURE__ */ pure(applicativeEither);
var runResolvedLenient2 = /* @__PURE__ */ runResolvedLenient(monadThrowEither);
var show9 = /* @__PURE__ */ show(showParseError);
var traverse5 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable8 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var map17 = /* @__PURE__ */ map(functorArray);
var union5 = /* @__PURE__ */ union(ordString);
var show12 = /* @__PURE__ */ show(showError);
var monadThrowWriterT3 = /* @__PURE__ */ monadThrowWriterT(monoidArray)(monadThrowEither);
var refEngineWith2 = /* @__PURE__ */ refEngineWith(monadThrowWriterT3);
var blockHelperMissing2 = /* @__PURE__ */ blockHelperMissing(monadThrowWriterT3);
var surfaceClauses = ["else", "elif"];
var desugarSurfaceWith = function(lv) {
  return desugarWith(lv)(surfaceClauses);
};
var desugarSurface = /* @__PURE__ */ desugar(surfaceClauses);
var checkBareInline = function(strict) {
  return function(nodes) {
    if (strict) {
      var v = bareInlineOffset(nodes);
      if (v instanceof Just) {
        return new Left(new DisallowedShape('{{#inline}} (an inline partial uses the {{#*inline "name"}} decorator)', v.value0));
      }
      ;
      if (v instanceof Nothing) {
        return pure3(unit);
      }
      ;
      throw new Error("Failed pattern match at FullBars (line 76, column 14 - line 81, column 27): " + [v.constructor.name]);
    }
    ;
    if (otherwise) {
      return pure3(unit);
    }
    ;
    throw new Error("Failed pattern match at FullBars (line 74, column 1 - line 74, column 65): " + [strict.constructor.name, nodes.constructor.name]);
  };
};
var renderSurfaceDiagWith = function(strict) {
  return function(lv) {
    return function(opts) {
      return function(truthy) {
        return function(src) {
          return function(dat) {
            var v = parseWith(opts)(src);
            if (v instanceof Left) {
              return new Left(renderParseErrorAt(src)(v.value0));
            }
            ;
            var v1 = function(v2) {
              if (v instanceof Right) {
                var v3 = hoistInline(desugarSurfaceWith(lv)(v.value0.nodes));
                var v4 = runResolvedLenient2(v.value0.directives)((function() {
                  var $146 = withTruthy(truthy);
                  var $147 = registerPartials(v3.partials);
                  return function($148) {
                    return $146($147($148));
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
                throw new Error("Failed pattern match at FullBars (line 198, column 7 - line 202, column 31): " + [v4.constructor.name]);
              }
              ;
              throw new Error("Failed pattern match at FullBars (line 189, column 1 - line 190, column 94): " + [v.constructor.name]);
            };
            if (v instanceof Right) {
              var $72 = checkBareInline(strict)(v.value0.nodes);
              if ($72 instanceof Left) {
                return new Left(renderParseErrorAt(src)($72.value0));
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
var renderSurfaceDiag = /* @__PURE__ */ renderSurfaceDiagWith(true)(noLoopVars)(defaultParseOptions)(handlebars);
var renderSurfaceWith = function(partialSrcs) {
  return function(src) {
    return function(dat) {
      var compilePartial = function(v3) {
        var v12 = parse(v3.value1);
        if (v12 instanceof Left) {
          return new Left(show9(v12.value0));
        }
        ;
        if (v12 instanceof Right) {
          return new Right({
            name: v3.value0,
            template: desugarSurface(v12.value0.nodes)
          });
        }
        ;
        throw new Error("Failed pattern match at FullBars (line 120, column 35 - line 122, column 70): " + [v12.constructor.name]);
      };
      var v = traverse5(compilePartial)(partialSrcs);
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        var v1 = parse(src);
        if (v1 instanceof Left) {
          return new Left(show9(v1.value0));
        }
        ;
        var v2 = function(v3) {
          if (v1 instanceof Right) {
            var v4 = hoistInline(desugarSurface(v1.value0.nodes));
            var externalT = fromFoldable8(map17(function(p) {
              return new Tuple(p.name, p.template);
            })(v.value0));
            var setup = registerPartials(union5(v4.partials)(externalT));
            var v5 = runResolvedLenient2(v1.value0.directives)(setup)(v4.template)(dat);
            if (v5 instanceof Left) {
              return new Left(show12(v5.value0));
            }
            ;
            if (v5 instanceof Right) {
              return new Right(v5.value0);
            }
            ;
            throw new Error("Failed pattern match at FullBars (line 114, column 11 - line 116, column 35): " + [v5.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FullBars (line 101, column 1 - line 101, column 92): " + [v1.constructor.name]);
        };
        if (v1 instanceof Right) {
          var $98 = checkBareInline(true)(v1.value0.nodes);
          if ($98 instanceof Left) {
            return new Left(renderParseErrorAt(src)($98.value0));
          }
          ;
          return v2(true);
        }
        ;
        return v2(true);
      }
      ;
      throw new Error("Failed pattern match at FullBars (line 103, column 3 - line 116, column 35): " + [v.constructor.name]);
    };
  };
};
var renderSurfaceWithHelpersWith = function(strict) {
  return function(lv) {
    return function(opts) {
      return function(truthy) {
        return function(helpers) {
          return function(partialSrcs) {
            return function(src) {
              return function(dat) {
                var compilePartial = function(v3) {
                  var v12 = parseWith(opts)(v3.value1);
                  if (v12 instanceof Left) {
                    return new Left(renderParseErrorAt(v3.value1)(v12.value0));
                  }
                  ;
                  if (v12 instanceof Right) {
                    return new Right({
                      name: v3.value0,
                      template: desugarSurfaceWith(lv)(v12.value0.nodes)
                    });
                  }
                  ;
                  throw new Error("Failed pattern match at FullBars (line 176, column 35 - line 178, column 77): " + [v12.constructor.name]);
                };
                var v = traverse5(compilePartial)(partialSrcs);
                if (v instanceof Left) {
                  return new Left(v.value0);
                }
                ;
                if (v instanceof Right) {
                  var v1 = parseWith(opts)(src);
                  if (v1 instanceof Left) {
                    return new Left(renderParseErrorAt(src)(v1.value0));
                  }
                  ;
                  var v2 = function(v3) {
                    if (v1 instanceof Right) {
                      var v4 = hoistInline(desugarSurfaceWith(lv)(v1.value0.nodes));
                      var externalT = fromFoldable8(map17(function(p) {
                        return new Tuple(p.name, p.template);
                      })(v.value0));
                      var setup = (function() {
                        var $151 = withTruthy(truthy);
                        var $152 = registerAll(helpers);
                        var $153 = registerPartials(union5(v4.partials)(externalT));
                        return function($154) {
                          return $151($152($153($154)));
                        };
                      })();
                      var v5 = runResolvedLenient2(v1.value0.directives)(setup)(v4.template)(dat);
                      if (v5 instanceof Left) {
                        return new Left(formatError(src)(v5.value0));
                      }
                      ;
                      if (v5 instanceof Right) {
                        return new Right(v5.value0);
                      }
                      ;
                      throw new Error("Failed pattern match at FullBars (line 170, column 11 - line 172, column 35): " + [v5.constructor.name]);
                    }
                    ;
                    throw new Error("Failed pattern match at FullBars (line 145, column 1 - line 154, column 26): " + [v1.constructor.name]);
                  };
                  if (v1 instanceof Right) {
                    var $125 = checkBareInline(strict)(v1.value0.nodes);
                    if ($125 instanceof Left) {
                      return new Left(renderParseErrorAt(src)($125.value0));
                    }
                    ;
                    return v2(true);
                  }
                  ;
                  return v2(true);
                }
                ;
                throw new Error("Failed pattern match at FullBars (line 156, column 3 - line 172, column 35): " + [v.constructor.name]);
              };
            };
          };
        };
      };
    };
  };
};
var renderSurfaceWithHelpers = /* @__PURE__ */ renderSurfaceWithHelpersWith(true)(noLoopVars)(defaultParseOptions)(handlebars);
var analyseSurface = function(src) {
  return function(dat) {
    var v = parse(src);
    if (v instanceof Left) {
      return new Left(renderParseErrorAt(src)(v.value0));
    }
    ;
    var v1 = function(v2) {
      if (v instanceof Right) {
        var v3 = hoistInline(desugarSurface(v.value0.nodes));
        var v4 = runAnalysis(refEngineWith2(blockHelperMissing2))(registerPartials(v3.partials))(v3.template)(dat);
        if (v4 instanceof Left) {
          return new Left(formatError(src)(v4.value0));
        }
        ;
        if (v4 instanceof Right) {
          return new Right({
            output: v4.value0.output,
            report: reportMarkdown(src)(v4.value0.decisions),
            jsonata: jsonataScaffold(src)(v4.value0.decisions),
            findings: findings(src)(v4.value0.decisions)
          });
        }
        ;
        throw new Error("Failed pattern match at FullBars (line 227, column 7 - line 236, column 12): " + [v4.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at FullBars (line 215, column 1 - line 219, column 92): " + [v.constructor.name]);
    };
    if (v instanceof Right) {
      var $142 = checkBareInline(true)(v.value0.nodes);
      if ($142 instanceof Left) {
        return new Left(renderParseErrorAt(src)($142.value0));
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
};

// output/FlatBars.Compile/index.js
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
var foldMap4 = /* @__PURE__ */ foldMap(foldableArray)(monoidString);
var show10 = /* @__PURE__ */ show(showInt);
var map18 = /* @__PURE__ */ map(functorArray);
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
    return singleton6(c);
  };
  return '"' + (foldMap4(esc)(toCharArray(s)) + '"');
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
              return foldMap4(node(ctx2))(ts);
            };
          },
          child: function(ctx2) {
            return {
              scope: "c" + show10(ctx2.depth + 1 | 0),
              depth: ctx2.depth + 1 | 0
            };
          }
        };
        var node = function(ctx2) {
          return function(v) {
            if (v instanceof Content) {
              return stmtOut(jsString(v.value0));
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
              return stmtOut("rt.raw(" + (jsString(v.value1) + (", " + (jsString(v.value3) + ")"))));
            }
            ;
            if (v instanceof NodeError) {
              return "";
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Compile (line 122, column 14 - line 138, column 24): " + [v.constructor.name]);
          };
        };
        var commaArgs = function(ctx2) {
          var $32 = joinWith(", ");
          var $33 = map18(rec.expr(ctx2));
          return function($34) {
            return $32($33($34));
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
        var $lazy_registry = $runtime_lazy4("registry", "FlatBars.Compile", function() {
          if ($$null(partials)) {
            return "";
          }
          ;
          if (otherwise) {
            return "  partials = Object.assign({}, partials, {\n" + (joinWith(",\n")(map18(function(v) {
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
var show11 = /* @__PURE__ */ show(showNumber);
var map19 = /* @__PURE__ */ map(functorArray);
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
var runtimeVersion = "0.1.0";
var metaFor = function(truthyCallback) {
  return {
    runtimeVersion,
    preamble: "",
    seed: "rt.scope(data, " + (truthyCallback + ")")
  };
};
var litJs = function(v) {
  if (v instanceof VString) {
    return jsString(v.value0);
  }
  ;
  if (v instanceof VNumber) {
    return show11(v.value0);
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
  throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 77, column 9 - line 84, column 22): " + [v.constructor.name]);
};
var lambda = function(rec) {
  return function(ctx2) {
    return function(body) {
      return "function (" + (ctx2.scope + (') { let out = "";\n' + (rec.nodes(ctx2)(body) + "  return out; }")));
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
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 241, column 22 - line 243, column 20): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 143, column 29 - line 154, column 55): " + [v.constructor.name]);
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
      return "{" + (joinWith(", ")(map19(one2)(clauses)) + "}");
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
            var names = "[" + (joinWith(", ")(map19(jsString)(bindingNames2(drop(1)(args)))) + "]");
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
              throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 171, column 18 - line 173, column 20): " + [v.constructor.name]);
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
    var $57 = joinWith(", ");
    var $58 = map19(rec.expr(ctx2));
    return function($59) {
      return $57($58($59));
    };
  };
};
var rtBlock = function(rec) {
  return function(ctx2) {
    return function(name2) {
      return function(split2) {
        return function(body) {
          var s = splitClauses(body);
          var paramsJs = "[" + (joinWith(", ")(map19(jsString)(split2.params)) + "]");
          var nDrop = length(split2.params) + (function() {
            var $37 = isJust(split2.hash);
            if ($37) {
              return 1;
            }
            ;
            return 0;
          })() | 0;
          var realArgs = take(length(split2.positional) - nDrop | 0)(split2.positional);
          var hashJs = maybe("null")(rec.expr(ctx2))(split2.hash);
          return "  out += rt.block(" + (jsString(name2) + (", [" + (args$prime(rec)(ctx2)(realArgs) + ("], " + (ctx2.scope + (", " + (lambda(rec)(rec.child(ctx2))(s.before) + (", " + (clausesObj(rec)(ctx2)(s.clauses) + (", { hash: " + (hashJs + (", params: " + (paramsJs + " });\n")))))))))))));
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
        throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 72, column 24 - line 74, column 20): " + [v.constructor.name]);
      };
    };
  };
};
var fbBlock = function(rec) {
  return function(ctx2) {
    return function(name2) {
      return function(args) {
        return function(body) {
          var split2 = splitBlockArgs(args);
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
          if (name2 === "inline") {
            return "";
          }
          ;
          if (name2 === "partial") {
            return "  out += rt.partialBlock(" + (argAt(rec)(ctx2)(args)(0) + (", " + (argAt(rec)(ctx2)(args)(1) + (", " + (argAt(rec)(ctx2)(args)(2) + (", partials, rt, " + (bodyThunk(rec)(ctx2)(body) + ");\n")))))));
          }
          ;
          return rtBlock(rec)(ctx2)(name2)(split2)(body);
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
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 54, column 18 - line 67, column 92): " + [v.constructor.name]);
    };
  };
};
var fullbarsEmit = {
  expr: fbExpr,
  block: fbBlock
};

// output/FullBars.Compile/index.js
var bind4 = /* @__PURE__ */ bind(bindEither);
var discard4 = /* @__PURE__ */ discard(discardUnit)(bindEither);
var pure4 = /* @__PURE__ */ pure(applicativeEither);
var toUnfoldable7 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var compileSurfaceWith = function(strict) {
  return function(lv) {
    return function(opts) {
      return function(truthyCallback) {
        return function(src) {
          return bind4(parseWith(opts)(src))(function(v) {
            return discard4(checkBareInline(strict)(v.nodes))(function() {
              var h = hoistInline(desugarSurfaceWith(lv)(v.nodes));
              return pure4(compile(metaFor(truthyCallback))(fullbarsEmit)(toUnfoldable7(h.partials))(h.template));
            });
          });
        };
      };
    };
  };
};
var compileSurface = /* @__PURE__ */ compileSurfaceWith(true)(noLoopVars)(defaultParseOptions)("rt.truthyHandlebars");

// output/Linter.Aliases/index.js
var lookup7 = /* @__PURE__ */ lookup(foldableArray)(eqString);
var scopedCanonWarnings = /* @__PURE__ */ (function() {
  var warnOf = function(ref) {
    var v = lookup7(ref.name)(scopedCanonical);
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
    throw new Error("Failed pattern match at Linter.Aliases (line 85, column 16 - line 94, column 23): " + [v.constructor.name]);
  };
  var $13 = mapMaybe(warnOf);
  return function($14) {
    return $13(operationRefs($14));
  };
})();
var aliasWarnings = /* @__PURE__ */ (function() {
  var warnOf = function(ref) {
    var v = lookup7(ref.name)(preludeAliases);
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
    throw new Error("Failed pattern match at Linter.Aliases (line 58, column 16 - line 69, column 23): " + [v.constructor.name]);
  };
  var $16 = mapMaybe(warnOf);
  return function($17) {
    return $16(operationRefs($17));
  };
})();

// output/Linter.Migrate/index.js
var eq5 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var lookup8 = /* @__PURE__ */ lookup(foldableArray)(eqString);
var elem7 = /* @__PURE__ */ elem2(eqString);
var bind5 = /* @__PURE__ */ bind(bindEither);
var pure5 = /* @__PURE__ */ pure(applicativeEither);
var append14 = /* @__PURE__ */ append(semigroupArray);
var CloseUnless = /* @__PURE__ */ (function() {
  function CloseUnless2() {
  }
  ;
  CloseUnless2.value = new CloseUnless2();
  return CloseUnless2;
})();
var CloseVerbatim = /* @__PURE__ */ (function() {
  function CloseVerbatim2() {
  }
  ;
  CloseVerbatim2.value = new CloseVerbatim2();
  return CloseVerbatim2;
})();
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
      throw new Error("Failed pattern match at Linter.Migrate (line 310, column 23 - line 312, column 32): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_s, $copy_depth);
    }
    ;
    return $tco_result;
  };
};
var sliceSpan = function(src) {
  return function(span2) {
    return slice2(span2.start)(span2.end)(src);
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
var matchAt2 = function(cs) {
  return function(i) {
    return function(pat) {
      var pcs = toCharArray(pat);
      return eq5(slice(i)(i + length(pcs) | 0)(cs))(pcs);
    };
  };
};
var loopField = function(name2) {
  return lookup8(name2)(loopFieldCanonical);
};
var knownBlockHelpers = blockHelperNames;
var joinReplicate = function(n) {
  return function(sep) {
    return joinWith("")(replicate(n)(sep));
  };
};
var migrateAtName = function(name2) {
  var v = stripDotDot(name2)(0);
  var $43 = v.depth > 0;
  if ($43) {
    return new Just((function() {
      var v12 = loopField(v.rest);
      if (v12 instanceof Just) {
        return "loop" + (joinReplicate(v.depth)(".parent") + ("." + v12.value0));
      }
      ;
      if (v12 instanceof Nothing) {
        var chain = joinWith(".")(replicate(v.depth)("parent"));
        var $46 = v.rest === "";
        if ($46) {
          return chain;
        }
        ;
        return chain + ("." + v.rest);
      }
      ;
      throw new Error("Failed pattern match at Linter.Migrate (line 287, column 9 - line 293, column 65): " + [v12.constructor.name]);
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
  throw new Error("Failed pattern match at Linter.Migrate (line 295, column 10 - line 300, column 31): " + [v1.constructor.name]);
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
  throw new Error("Failed pattern match at Linter.Migrate (line 212, column 30 - line 214, column 19): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at Linter.Migrate (line 268, column 5 - line 270, column 25): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at Linter.Migrate (line 253, column 27 - line 255, column 32): " + [v.constructor.name]);
  };
};
var isBareName = function(s) {
  return s !== "" && (!contains(" ")(s) && (!contains("	")(s) && !contains("(")(s)));
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
          throw new Error("Failed pattern match at Linter.Migrate (line 477, column 3 - line 480, column 30): " + [i.constructor.name]);
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
          throw new Error("Failed pattern match at Linter.Migrate (line 442, column 9 - line 463, column 36): " + [v.constructor.name]);
        }
        ;
        if (otherwise) {
          $tco_var_i = i + 1 | 0;
          $copy_acc = acc;
          return;
        }
        ;
        throw new Error("Failed pattern match at Linter.Migrate (line 438, column 3 - line 438, column 48): " + [i.constructor.name, acc.constructor.name]);
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
var charStr = singleton6;
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
              throw new Error("Failed pattern match at Linter.Migrate (line 242, column 11 - line 245, column 68): " + [v1.constructor.name]);
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
          throw new Error("Failed pattern match at Linter.Migrate (line 238, column 19 - line 246, column 66): " + [v.constructor.name]);
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
    var tildeR = (function() {
      if (trail) {
        return "~";
      }
      ;
      return "";
    })();
    var tildeL = (function() {
      if (lead) {
        return "~";
      }
      ;
      return "";
    })();
    var cond = mapDataNames(trim(v.value0));
    return new Just(tildeL + ("elif " + (cond + tildeR)));
  }
  ;
  if (v instanceof Nothing) {
    return Nothing.value;
  }
  ;
  throw new Error("Failed pattern match at Linter.Migrate (line 347, column 5 - line 355, column 25): " + [v.constructor.name]);
};
var ambiguousSection = function(span2) {
  return function(sigil) {
    return function(interior) {
      if (sigil instanceof Section) {
        var core = stripTildes(interior);
        var name2 = trim(core);
        var $75 = isBareName(name2) && !elem7(name2)(knownBlockHelpers);
        if ($75) {
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
        return emit(acc)(v.value0);
      }
      ;
      if (v instanceof ROutput) {
        return emit(acc)(mapDataInTag(sliceSpan(src)(v.value0)));
      }
      ;
      if (v instanceof RAmp) {
        return emit(acc)("{{{" + (mapDataNames(v.value2) + "}}}"));
      }
      ;
      if (v instanceof ROpen) {
        var acc1 = addResiduals(acc)(openResiduals(v.value0)(v.value1)(v.value3));
        if (v.value1 instanceof Inverse) {
          return push2(emit(acc1)("{{#unless " + (mapDataNames(v.value3) + "}}")))(CloseUnless.value);
        }
        ;
        return push2(emit(acc1)(mapDataInTag(sliceSpan(src)(v.value0))))(CloseVerbatim.value);
      }
      ;
      if (v instanceof RClose) {
        var v1 = head(acc.stack);
        if (v1 instanceof Just && v1.value0 instanceof CloseUnless) {
          return emit(popStack(acc))("{{/unless}}");
        }
        ;
        return emit(popStack(acc))(mapDataInTag(sliceSpan(src)(v.value0)));
      }
      ;
      if (v instanceof RSep) {
        var v1 = rewriteElseIf(v.value2);
        if (v1 instanceof Just) {
          return emit(acc)("{{" + (v1.value0 + "}}"));
        }
        ;
        if (v1 instanceof Nothing) {
          if (isPartialBlockRef(v.value2)) {
            return emit(acc)("{{yield}}");
          }
          ;
          if (otherwise) {
            return emit(acc)(mapDataInTag(sliceSpan(src)(v.value0)));
          }
          ;
        }
        ;
        throw new Error("Failed pattern match at Linter.Migrate (line 174, column 5 - line 178, column 68): " + [v1.constructor.name]);
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
      throw new Error("Failed pattern match at Linter.Migrate (line 137, column 16 - line 190, column 53): " + [v.constructor.name]);
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
  return bind5(tokenizeTemplate(defaultLexConfig)(defaultLexOptions)(src))(function(toks) {
    var walk2 = rewrite2(src)(toks);
    var delimResiduals = scanSetDelimiters(src);
    return pure5({
      source: walk2.source,
      residuals: append14(delimResiduals)(walk2.residuals)
    });
  });
};

// output/MaxBars.Expr/index.js
var map20 = /* @__PURE__ */ map(functorMaybe);
var bind6 = /* @__PURE__ */ bind(bindMaybe);
var bind1 = /* @__PURE__ */ bind(bindEither);
var map110 = /* @__PURE__ */ map(functorEither);
var isAtVar = function(name2) {
  return isJust(stripPrefix("@")(name2));
};
var atVarError = /* @__PURE__ */ (function() {
  return LexError.create("'@\u2026' variables are not used in MaxBars; read the loop/context model instead (e.g. {{loop.index0}}, {{parent.x}}, {{root.y}})");
})();
var combinators = function(toks) {
  var tk = function(i) {
    return map20(function(v) {
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
      throw new Error("Failed pattern match at MaxBars.Expr (line 108, column 16 - line 110, column 19): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Expr (line 106, column 13 - line 110, column 19): " + [v.constructor.name]);
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
            var v = bind6(tk(pos))(match);
            if (v instanceof Just) {
              return bind1(sub3(pos + 1 | 0))(function(r) {
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
            throw new Error("Failed pattern match at MaxBars.Expr (line 120, column 20 - line 122, column 41): " + [v.constructor.name]);
          };
        };
        return bind1(sub3(i))(function(first) {
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
      return Nothing.value;
    };
  })();
  var ladder = function(withPipe) {
    return function(term) {
      var pUnary = function(i) {
        var v = tk(i);
        if (v instanceof Just && (v.value0 instanceof TOp && v.value0.value0 === "!")) {
          return bind1(pUnary(i + 1 | 0))(function(r) {
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
      var pCmp = function(i) {
        return bind1(pAdd(i))(function(lhs) {
          var v = bind6(tk(lhs.pos))(cmpOp);
          if (v instanceof Just) {
            return bind1(pAdd(lhs.pos + 1 | 0))(function(r) {
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
          throw new Error("Failed pattern match at MaxBars.Expr (line 137, column 33 - line 139, column 54): " + [v.constructor.name]);
        });
      };
      var pAnd = function(i) {
        return binL(binOp("&&")("and"))(pCmp)(i);
      };
      var pOr = function(i) {
        return binL(binOp("||")("or"))(pAnd)(i);
      };
      var pCoalesce = function(i) {
        return binL(binOp("??")("coalesce"))(pOr)(i);
      };
      var pPipe = function(i) {
        return binL(pipeOp)(pCoalesce)(i);
      };
      if (withPipe) {
        return pPipe;
      }
      ;
      return pCoalesce;
    };
  };
  var pAtom = function(i) {
    var v = tk(i);
    if (v instanceof Just && v.value0 instanceof TLParen) {
      return bind1(exprLadder(i + 1 | 0))(function(r) {
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
      return new Right({
        val: new App2("|", []),
        pos: i + 1 | 0
      });
    }
    ;
    return new Left(new LexError("expected an expression", posAt(i)));
  };
  var pArgs = function(i) {
    return function(acc) {
      var v = tk(i);
      if (v instanceof Just && v.value0 instanceof TLParen) {
        return bind1(pAtom(i))(function(r) {
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
        return bind1(pArgs(i + 1 | 0)([]))(function(r) {
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
  throw new Error("Failed pattern match at MaxBars.Expr (line 60, column 21 - line 64, column 66): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at MaxBars.Expr (line 85, column 19 - line 89, column 62): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Expr (line 83, column 3 - line 89, column 62): " + [i.constructor.name, acc.constructor.name]);
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
      return map110(App2.create(v.value0.value0))(collect2(1)([]));
    }
    ;
  }
  ;
  return new Left(new LexError("expected a block helper name", comb.posAt(0)));
};

// output/MaxBars/index.js
var maxOptions = /* @__PURE__ */ (function() {
  return {
    trimStandalone: defaultParseOptions.trimStandalone,
    inheritance: defaultParseOptions.inheritance,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    lexConfig: defaultParseOptions.lexConfig,
    parseExpr: parseMaxExpr,
    parseHead: parseMaxHead,
    extras: false,
    decorators: false,
    partialBlocks: false,
    rawBlockHbs: false,
    rawBlockHash: true,
    lexOptions: {
      infixArith: true
    }
  };
})();
var maxLoopVars = /* @__PURE__ */ reservedScope(noLoopVars);
var renderMax = /* @__PURE__ */ renderSurfaceDiagWith(false)(maxLoopVars)(maxOptions)(nonEmpty);
var renderWithOperations = /* @__PURE__ */ renderSurfaceWithHelpersWith(false)(maxLoopVars)(maxOptions)(nonEmpty);
var compileMaxJs = /* @__PURE__ */ compileSurfaceWith(false)(maxLoopVars)(maxOptions)("rt.truthyNonEmpty");

// output/MinBars.Compile/index.js
var show13 = /* @__PURE__ */ show(showNumber);
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
    return show13(v.value0);
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
var lookup9 = /* @__PURE__ */ lookup3(ordString);
var foldl5 = /* @__PURE__ */ foldl(foldableList);
var walk = function($copy_key) {
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
          var v2 = lookup9(key)(v.value0.value0);
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
      return fromMaybe(VNull.value)(lookup9(seg)(acc.value0));
    }
    ;
    return VNull.value;
  };
};
var mresolve = function(name2) {
  return function(v) {
    if (name2 === ".") {
      return fromMaybe(VNull.value)(head2(v.stack));
    }
    ;
    if (otherwise) {
      var v1 = uncons(split(".")(name2));
      if (v1 instanceof Nothing) {
        return VNull.value;
      }
      ;
      if (v1 instanceof Just) {
        var base = walk(v1.value0.head)(v.stack);
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
      var v = lookup9(name2)(layer);
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
  return foldl5(pick)(Nothing.value);
};

// output/MinBars.Prelude/index.js
var traverse6 = /* @__PURE__ */ traverse(traversableArray);
var eq33 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqString));
var append15 = /* @__PURE__ */ append(semigroupArray);
var lookup10 = /* @__PURE__ */ lookup3(ordString);
var stringifyOrEmpty = function(dictMonadThrow) {
  var $190 = liftEither(dictMonadThrow);
  return function($191) {
    return $190(stringify2($191));
  };
};
var sectionH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var map27 = map(Monad0.Bind1().Apply0().Functor0());
  var traverse13 = traverse6(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        var items = (function() {
          if (args[0] instanceof VArray) {
            return args[0].value0;
          }
          ;
          var $110 = minTruthy(ctl.env)(args[0]);
          if ($110) {
            return [args[0]];
          }
          ;
          return [];
        })();
        return map27((function() {
          var $192 = joinWith("");
          return function($193) {
            return VSafe.create($192($193));
          };
        })())(traverse13(function(it) {
          return ctl.render(push3(it)(ctl.env))(ctl.children);
        })(items));
      }
      ;
      return throwError3(new HelperError("section: expected exactly one argument"));
    };
  };
};
var mlookupH = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1 && args[0] instanceof VString) {
        return pure8(mresolve(args[0].value0)(ctl.env));
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
  var map27 = map(Monad0.Bind1().Apply0().Functor0());
  var pure8 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        var $116 = !minTruthy(ctl.env)(args[0]);
        if ($116) {
          return map27(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        return pure8(new VSafe(""));
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
                  var $120 = j === 0 && atLineStart || j > 0;
                  if ($120) {
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
            var endsNL = lastP >= 0 && eq33(index(parts)(lastP))(new Just(""));
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
                var v1 = indentContent(atLineStart)(isLast)(v.value0.head.value0);
                return cons(new Content(v1.text))(go(v1.nextAtLineStart)(i + 1 | 0)(v.value0.tail));
              }
              ;
              var pre = (function() {
                if (atLineStart) {
                  return [new Content(indent)];
                }
                ;
                return [];
              })();
              return append15(pre)(cons(v.value0.head)(go(false)(i + 1 | 0)(v.value0.tail)));
            }
            ;
            throw new Error("Failed pattern match at MinBars.Prelude (line 291, column 32 - line 309, column 66): " + [v.constructor.name]);
          };
        };
      };
      return go(true)(0)(tmpl);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Prelude (line 285, column 1 - line 285, column 49): " + [indent.constructor.name, tmpl.constructor.name]);
  };
};
var partialH2 = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var map27 = map(Monad0.Bind1().Apply0().Functor0());
  var pure8 = pure(Monad0.Applicative0());
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = lookup10(args[0].value0)(minPartials(ctl.env));
        if (v instanceof Just) {
          if (minDepth(ctl.env) >= recursionBudget) {
            return throwError3(new RecursionLimit(recursionBudget));
          }
          ;
          if (otherwise) {
            return map27(VSafe.create)(ctl.render(enterPartial2(ctl.env))(indentTemplate(args[1].value0)(v.value0)));
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure8(new VSafe(""));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 127, column 39 - line 131, column 31): " + [v.constructor.name]);
      }
      ;
      return pure8(new VSafe(""));
    };
  };
};
var escapeH = function(dictMonadThrow) {
  var map27 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyOrEmpty1 = stringifyOrEmpty(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      if (args.length === 1) {
        return map27(function($194) {
          return VSafe.create(escapeHtml($194));
        })(stringifyOrEmpty1(args[0]));
      }
      ;
      return throwError3(new HelperError("escape: expected exactly one argument"));
    };
  };
};
var ensureTrailingNL = function(s) {
  var $141 = takeRight(1)(s) === "\n";
  if ($141) {
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
          var $144 = i === lastI && l === "" || l === "";
          if ($144) {
            return l;
          }
          ;
          return indent + l;
        };
      };
      return ensureTrailingNL(joinWith("\n")(mapWithIndex2(prefix)(ls)));
    }
    ;
    throw new Error("Failed pattern match at MinBars.Prelude (line 265, column 1 - line 265, column 45): " + [indent.constructor.name, body.constructor.name]);
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
            var $145 = i === 0 && !atLineStart;
            if ($145) {
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
            var v1 = dropContent(atLineStart)(amount)(v.value0.head.value0);
            return cons(new Content(v1.text))(go(v1.nextAtLineStart)(amount)(v.value0.tail));
          }
          ;
          return cons(v.value0.head)(go(false)(amount)(v.value0.tail));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 195, column 33 - line 203, column 55): " + [v.constructor.name]);
      };
    };
  };
  return function(tmpl) {
    var amount = (function() {
      var v = head(tmpl);
      if (v instanceof Just && v.value0 instanceof Content) {
        return leadingIndent(v.value0.value0);
      }
      ;
      return "";
    })();
    var $158 = amount === "";
    if ($158) {
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
  var $195 = fromFoldable3(ordString)(foldableArray);
  var $196 = mapMaybe(blockChild);
  return function($197) {
    return $195($196($197));
  };
})();
var parentH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var map27 = map(Monad0.Bind1().Apply0().Functor0());
  var pure8 = pure(Monad0.Applicative0());
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = lookup10(args[0].value0)(minPartials(ctl.env));
        if (v instanceof Just) {
          if (minDepth(ctl.env) >= recursionBudget) {
            return throwError3(new RecursionLimit(recursionBudget));
          }
          ;
          if (otherwise) {
            var overrides = harvestBlocks(ctl.children);
            var env$prime = layerBlocks(overrides)(enterPartial2(ctl.env));
            return map27(VSafe.create)(ctl.render(env$prime)(indentTemplate(args[1].value0)(v.value0)));
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure8(new VSafe(""));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 145, column 39 - line 156, column 31): " + [v.constructor.name]);
      }
      ;
      return pure8(new VSafe(""));
    };
  };
};
var blockH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var pure8 = pure(Monad0.Applicative0());
  var map27 = map(Bind1.Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = blookup(args[0].value0)(minBlocks(ctl.env));
        if (v instanceof Just) {
          return bind9((function() {
            var $179 = args[1].value0 !== "";
            if ($179) {
              return pure8(args[1].value0);
            }
            ;
            return map27(leadingIndent)(ctl.render(ctl.env)(ctl.children));
          })())(function(expand) {
            return bind9(ctl.render(ctl.env)(v.value0))(function(out) {
              return pure8(new VSafe(indentOverride(expand)(out)));
            });
          });
        }
        ;
        if (v instanceof Nothing) {
          return map27(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 232, column 39 - line 243, column 57): " + [v.constructor.name]);
      }
      ;
      if (args.length === 1 && args[0] instanceof VString) {
        var v = blookup(args[0].value0)(minBlocks(ctl.env));
        if (v instanceof Just) {
          return map27(VSafe.create)(ctl.render(ctl.env)(v.value0));
        }
        ;
        if (v instanceof Nothing) {
          return map27(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 246, column 23 - line 248, column 57): " + [v.constructor.name]);
      }
      ;
      return throwError3(new HelperError("block: expected exactly one string name"));
    };
  };
};
var minEngine = function(dictMonadThrow) {
  var pure8 = pure(dictMonadThrow.Monad0().Applicative0());
  var mlookupH1 = mlookupH(dictMonadThrow);
  var escapeH1 = escapeH(dictMonadThrow);
  var sectionH1 = sectionH(dictMonadThrow);
  var invertedH1 = invertedH(dictMonadThrow);
  var partialH1 = partialH2(dictMonadThrow);
  var parentH1 = parentH(dictMonadThrow);
  var blockH1 = blockH(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  var liftEither2 = liftEither(dictMonadThrow);
  return function(initial) {
    return {
      initial,
      resolve: function(v) {
        return function(name2) {
          if (name2 === "mlookup") {
            return pure8(mlookupH1);
          }
          ;
          if (name2 === "escape") {
            return pure8(escapeH1);
          }
          ;
          if (name2 === "section") {
            return pure8(sectionH1);
          }
          ;
          if (name2 === "inverted") {
            return pure8(invertedH1);
          }
          ;
          if (name2 === "partial") {
            return pure8(partialH1);
          }
          ;
          if (name2 === "parent") {
            return pure8(parentH1);
          }
          ;
          if (name2 === "block") {
            return pure8(blockH1);
          }
          ;
          return throwError3(new HelperError("unknown MinBars helper '" + (name2 + "'")));
        };
      },
      stringify: function(v) {
        return liftEither2(stringify2(v));
      },
      blockArgs: function(args) {
        return {
          positional: args,
          hash: Nothing.value,
          params: [],
          label: Nothing.value
        };
      }
    };
  };
};

// output/MinBars.Standalone/index.js
var notEq5 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
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
var hasNL2 = function(s) {
  return notEq5(nlIndex2(true)(s))(Nothing.value);
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 75, column 24 - line 77, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 68, column 21 - line 70, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 61, column 19 - line 63, column 15): " + [v.constructor.name]);
};
var allWs2 = /* @__PURE__ */ (function() {
  var $84 = all2(isSpaceCU);
  return function($85) {
    return $84(toCharArray($85));
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 56, column 17 - line 58, column 15): " + [v.constructor.name]);
};
var mustacheStandalone = function(lx) {
  return function(toks0) {
    var rightBlank = function(i) {
      var v = index(toks0)(i + 1 | 0);
      if (v instanceof Nothing) {
        return true;
      }
      ;
      if (v instanceof Just && v.value0 instanceof RContent) {
        if (hasNL2(v.value0.value0)) {
          return allWs2(beforeFirstNL2(v.value0.value0));
        }
        ;
        if (otherwise) {
          return allWs2(v.value0.value0) && rightBlank(i + 1 | 0);
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
        if (hasNL2(v.value0.value0)) {
          return allWs2(afterLastNL2(v.value0.value0));
        }
        ;
        if (otherwise) {
          return allWs2(v.value0.value0) && leftBlank(i - 1 | 0);
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
            var $62 = standaloneAt(j - 1 | 0);
            if ($62) {
              return dropLeadingLine2(v.value0);
            }
            ;
            return v.value0;
          })();
          var s2 = (function() {
            var $63 = standaloneAt(j + 1 | 0);
            if ($63) {
              return dropTrailingIndent2(s1);
            }
            ;
            return s1;
          })();
          return new RContent(s2);
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
        return fromCharArray(takeWhile(isHWs)(toCharArray(afterLastNL2(v.value0.value0))));
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
            "int": tokenizeInterior(lx)(base)(s$prime)
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
};

// output/MinBars.Surface/index.js
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
var map21 = /* @__PURE__ */ map(functorMaybe);
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
  var v = map21(argName)(head(args));
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
var $lazy_desugar = /* @__PURE__ */ $runtime_lazy5("desugar", "MinBars.Surface", function() {
  var node = function(v) {
    if (v instanceof Content) {
      return new Content(v.value0);
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
  return map(functorArray)(node);
});
var desugar2 = /* @__PURE__ */ $lazy_desugar(40);

// output/MinBars/index.js
var bind7 = /* @__PURE__ */ bind(bindEither);
var pure6 = /* @__PURE__ */ pure(applicativeEither);
var runTemplate3 = /* @__PURE__ */ runTemplate(monadEither);
var minEngine2 = /* @__PURE__ */ minEngine(monadThrowEither);
var traverse7 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable9 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var elem8 = /* @__PURE__ */ elem(foldableList)(eqString);
var lookup11 = /* @__PURE__ */ lookup3(ordString);
var union6 = /* @__PURE__ */ union(ordString);
var map24 = /* @__PURE__ */ map(functorEither);
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
    parseExpr: defaultParseOptions.parseExpr,
    parseHead: defaultParseOptions.parseHead,
    rawBlockHash: defaultParseOptions.rawBlockHash,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    lexOptions: defaultParseOptions.lexOptions,
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
    return bind7(tokenizeTemplate(cfg)(minOptions.lexOptions)(src))(function(toks) {
      return bind7(collectDirectives(toks))(function(directives) {
        return bind7(buildFromTokens(minOptions)(mustacheStandalone(minOptions.lexOptions)(toks)))(function(nodes) {
          return pure6({
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
            var v1 = runTemplate3(minEngine2(seeded))(desugar2(v.value0.nodes));
            if (v1 instanceof Left) {
              return new Left(formatError(src)(v1.value0));
            }
            ;
            if (v1 instanceof Right) {
              return new Right(v1.value0);
            }
            ;
            throw new Error("Failed pattern match at MinBars (line 168, column 7 - line 170, column 31): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MinBars (line 162, column 44 - line 170, column 31): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at MinBars (line 137, column 35 - line 139, column 58): " + [v1.constructor.name]);
        };
        var v = traverse7(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          return renderCore(rule)(fromFoldable9(v.value0))(src)(dat);
        }
        ;
        throw new Error("Failed pattern match at MinBars (line 133, column 3 - line 135, column 62): " + [v.constructor.name]);
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
        return new Right(leadingIndent(v.value0.value0));
      }
      ;
      return new Left(new DisallowedShape("intrinsic block indentation with a non-static default (MinBars compile)", 0));
    }
    ;
    throw new Error("Failed pattern match at MinBars (line 320, column 1 - line 320, column 66): " + [indent.constructor.name, body.constructor.name]);
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
              if (elem8(v["value1"]["value1"][0].value0.value0)(chain)) {
                return new Left(new DisallowedShape("recursive partial '" + (v["value1"]["value1"][0].value0.value0 + "' (MinBars compile)"), 0));
              }
              ;
              if (otherwise) {
                var v1 = lookup11(v["value1"]["value1"][0].value0.value0)(partials);
                if (v1 instanceof Nothing) {
                  return new Right([]);
                }
                ;
                if (v1 instanceof Just) {
                  return inline(partials)(overrides)(new Cons(v["value1"]["value1"][0].value0.value0, chain))(depth)(indentTemplate(v["value1"]["value1"][1].value0.value0)(v1.value0));
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 277, column 22 - line 279, column 99): " + [v1.constructor.name]);
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
                var v1 = lookup11(v["value3"][0].value0.value0)(partials);
                if (v1 instanceof Nothing) {
                  return new Right([]);
                }
                ;
                if (v1 instanceof Just) {
                  return inline(partials)(union6(overrides)(harvestBlocks(v.value4)))(chain)(depth + 1 | 0)(indentTemplate(v["value3"][1].value0.value0)(v1.value0));
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 286, column 22 - line 290, column 45): " + [v1.constructor.name]);
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
                var v2 = lookup11(v1.value0.value0.value0)(overrides);
                if (v2 instanceof Nothing) {
                  return recurse(v.value4);
                }
                ;
                if (v2 instanceof Just) {
                  return bind7(recurse(v2.value0))(function(inlinedOverride) {
                    var $99 = length(v.value3) >= 2;
                    if ($99) {
                      return bind7(expansionIndent(blockIndent(v.value3))(v.value4))(function(expand) {
                        return new Right([new Block(v.value0, Section.value, "@reindent", [new Lit(new VString(expand))], inlinedOverride)]);
                      });
                    }
                    ;
                    return new Right(inlinedOverride);
                  });
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 295, column 36 - line 302, column 37): " + [v2.constructor.name]);
              }
              ;
              return new Left(new DisallowedShape("malformed block override (MinBars compile)", 0));
            }
            ;
            if (v instanceof Block) {
              return map24(function(b) {
                return [new Block(v.value0, v.value1, v.value2, v.value3, b)];
              })(recurse(v.value4));
            }
            ;
            return new Right([v]);
          };
          return map24(concat)(traverse7(one2)(tmpl));
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
      return bind7(parseMin(src))(function(v) {
        return bind7(map24(fromFoldable9)(traverse7(parsePartial)(partialSrcs)))(function(partials) {
          return bind7(inline(partials)(empty3)(Nil.value)(0)(desugar2(v.nodes)))(function(inlined) {
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
      var head3 = null;
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
            if (head3 === null) {
              break loop;
            }
            step2 = head3._2;
            if (tail2 === null) {
              head3 = null;
            } else {
              head3 = tail2._1;
              tail2 = tail2._2;
            }
            break;
          case MAP:
            step2 = step2._2;
            break;
          case APPLY:
          case ALT:
            if (head3) {
              tail2 = new Aff2(CONS, head3, tail2);
            }
            head3 = step2;
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
    function join2(result2, head3, tail2) {
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
        if (head3 === null) {
          cb(fail || step2)();
          return;
        }
        if (head3._3 !== EMPTY) {
          return;
        }
        switch (head3.tag) {
          case MAP:
            if (fail === null) {
              head3._3 = util.right(head3._1(util.fromRight(step2)));
              step2 = head3._3;
            } else {
              head3._3 = fail;
            }
            break;
          case APPLY:
            lhs = head3._1._3;
            rhs = head3._2._3;
            if (fail) {
              head3._3 = fail;
              tmp = true;
              kid = killId++;
              kills[kid] = kill(early, fail === lhs ? head3._2 : head3._1, function() {
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
              head3._3 = step2;
            }
            break;
          case ALT:
            lhs = head3._1._3;
            rhs = head3._2._3;
            if (lhs === EMPTY && util.isLeft(rhs) || rhs === EMPTY && util.isLeft(lhs)) {
              return;
            }
            if (lhs !== EMPTY && util.isLeft(lhs) && rhs !== EMPTY && util.isLeft(rhs)) {
              fail = step2 === lhs ? rhs : lhs;
              step2 = null;
              head3._3 = fail;
            } else {
              head3._3 = step2;
              tmp = true;
              kid = killId++;
              kills[kid] = kill(early, step2 === lhs ? head3._2 : head3._1, function() {
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
          head3 = null;
        } else {
          head3 = tail2._1;
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
      var head3 = null;
      var tail2 = null;
      var tmp, fid;
      loop: while (true) {
        tmp = null;
        fid = null;
        switch (status) {
          case CONTINUE:
            switch (step2.tag) {
              case MAP:
                if (head3) {
                  tail2 = new Aff2(CONS, head3, tail2);
                }
                head3 = new Aff2(MAP, step2._1, EMPTY, EMPTY);
                step2 = step2._2;
                break;
              case APPLY:
                if (head3) {
                  tail2 = new Aff2(CONS, head3, tail2);
                }
                head3 = new Aff2(APPLY, EMPTY, step2._2, EMPTY);
                step2 = step2._1;
                break;
              case ALT:
                if (head3) {
                  tail2 = new Aff2(CONS, head3, tail2);
                }
                head3 = new Aff2(ALT, EMPTY, step2._2, EMPTY);
                step2 = step2._1;
                break;
              default:
                fid = fiberId++;
                status = RETURN;
                tmp = step2;
                step2 = new Aff2(FORKED, fid, new Aff2(CONS, head3, tail2), EMPTY);
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
            if (head3 === null) {
              break loop;
            }
            if (head3._1 === EMPTY) {
              head3._1 = step2;
              status = CONTINUE;
              step2 = head3._2;
              head3._2 = EMPTY;
            } else {
              head3._2 = step2;
              step2 = head3;
              if (tail2 === null) {
                head3 = null;
              } else {
                head3 = tail2._1;
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

// output/RawBars/index.js
var lmap2 = /* @__PURE__ */ lmap(bifunctorEither);
var runResolved2 = /* @__PURE__ */ runResolved(monadThrowEither);
var traverse8 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable10 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var map25 = /* @__PURE__ */ map(functorArray);
var union7 = /* @__PURE__ */ union(ordString);
var bind8 = /* @__PURE__ */ bind(bindEither);
var pure1 = /* @__PURE__ */ pure(applicativeEither);
var toUnfoldable8 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var coreOptions = /* @__PURE__ */ (function() {
  return {
    trimStandalone: defaultParseOptions.trimStandalone,
    parseExpr: defaultParseOptions.parseExpr,
    parseHead: defaultParseOptions.parseHead,
    inheritance: defaultParseOptions.inheritance,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    lexOptions: defaultParseOptions.lexOptions,
    lexConfig: defaultParseOptions.lexConfig,
    extras: false,
    decorators: false,
    partialBlocks: false,
    rawBlockHbs: false,
    rawBlockHash: true
  };
})();
var renderDiag = function(src) {
  return function(dat) {
    var v = parseWith(coreOptions)(src);
    if (v instanceof Left) {
      return new Left(renderParseErrorAt(src)(v.value0));
    }
    ;
    if (v instanceof Right) {
      var h = hoistInline(v.value0.nodes);
      return lmap2(formatError(src))(runResolved2(v.value0.directives)((function() {
        var $71 = withTruthy(nonEmpty);
        var $72 = registerPartials(h.partials);
        return function($73) {
          return $71($72($73));
        };
      })())(h.template)(dat));
    }
    ;
    throw new Error("Failed pattern match at RawBars (line 102, column 22 - line 111, column 10): " + [v.constructor.name]);
  };
};
var renderWithOperations2 = function(operations) {
  return function(partialSrcs) {
    return function(src) {
      return function(dat) {
        var compilePartial = function(v2) {
          var v12 = parseWith(coreOptions)(v2.value1);
          if (v12 instanceof Left) {
            return new Left(renderParseErrorAt(v2.value1)(v12.value0));
          }
          ;
          if (v12 instanceof Right) {
            return new Right({
              name: v2.value0,
              template: v12.value0.nodes
            });
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 147, column 35 - line 149, column 55): " + [v12.constructor.name]);
        };
        var v = traverse8(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          var v1 = parseWith(coreOptions)(src);
          if (v1 instanceof Left) {
            return new Left(renderParseErrorAt(src)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            var h = hoistInline(v1.value0.nodes);
            var externalT = fromFoldable10(map25(function(p) {
              return new Tuple(p.name, p.template);
            })(v.value0));
            var setup = (function() {
              var $76 = withTruthy(nonEmpty);
              var $77 = registerAll(operations);
              var $78 = registerPartials(union7(h.partials)(externalT));
              return function($79) {
                return $76($77($78($79)));
              };
            })();
            return lmap2(formatError(src))(runResolved2(v1.value0.directives)(setup)(h.template)(dat));
          }
          ;
          throw new Error("Failed pattern match at RawBars (line 132, column 17 - line 145, column 79): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at RawBars (line 130, column 3 - line 145, column 79): " + [v.constructor.name]);
      };
    };
  };
};
var compileJsWith = function(opts) {
  return function(src) {
    return bind8(parseWith({
      trimStandalone: opts.trimStandalone,
      parseExpr: opts.parseExpr,
      parseHead: opts.parseHead,
      inheritance: opts.inheritance,
      rawBlockHbs: opts.rawBlockHbs,
      rawBlockHash: opts.rawBlockHash,
      standaloneSeps: opts.standaloneSeps,
      lexOptions: opts.lexOptions,
      lexConfig: opts.lexConfig,
      extras: false,
      decorators: false,
      partialBlocks: false
    })(src))(function(v) {
      var h = hoistInline(v.nodes);
      return pure1(compile(metaFor("rt.truthyNonEmpty"))(fullbarsEmit)(toUnfoldable8(h.partials))(h.template));
    });
  };
};
var compileJs = /* @__PURE__ */ compileJsWith(coreOptions);

// output/FullBars.JS/index.js
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
var show14 = /* @__PURE__ */ show(showNumber);
var toUnfoldable9 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var fromFoldable11 = /* @__PURE__ */ fromFoldable2(foldableArray);
var map26 = /* @__PURE__ */ map(functorArray);
var append5 = /* @__PURE__ */ append(semigroupArray);
var pure7 = /* @__PURE__ */ pure(applicativeEither);
var identity10 = /* @__PURE__ */ identity(categoryFn);
var throwError2 = /* @__PURE__ */ throwError(monadThrowEither);
var fromFoldable12 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var constOperation2 = /* @__PURE__ */ constOperation(applicativeEither);
var union8 = /* @__PURE__ */ union(ordString);
var show15 = /* @__PURE__ */ show(showError);
var elem9 = /* @__PURE__ */ elem2(eqString);
var str = id;
var tt2 = function(t) {
  return new Tuple("t", str(t));
};
var sevText = /* @__PURE__ */ show(showSeverity);
var segment = function(v) {
  if (v instanceof Lit && v.value0 instanceof VString) {
    return str(v.value0.value0);
  }
  ;
  if (v instanceof Lit && v.value0 instanceof VNumber) {
    return str(show14(v.value0.value0));
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
  return result(renderSurfaceWith(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderSurface = function(tpl, json) {
  return result(renderSurfaceDiag(tpl)(fromJson(json)));
};
var renderMustache = function(partials, tpl, json) {
  return result(renderMinWith(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderMinbarsCompatWithPartials = function(partials, tpl, json) {
  return result(renderMinCompatWith(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderMinbarsCompat = function(tpl, json) {
  return result(renderMinCompat(tpl)(fromJson(json)));
};
var renderMinbars = function(tpl, json) {
  return result(renderMinDiag(tpl)(fromJson(json)));
};
var renderMaxbars = function(tpl, json) {
  return result(renderMax(tpl)(fromJson(json)));
};
var render = function(tpl, json) {
  return result(renderDiag(tpl)(fromJson(json)));
};
var obj = function(kvs) {
  return id(fromFoldable11(kvs));
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
      residuals: map26(function(x) {
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
  throw new Error("Failed pattern match at FullBars.JS (line 204, column 25 - line 212, column 6): " + [v.constructor.name]);
};
var litName = function(args) {
  var v = head(args);
  if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
    return new Just(v.value0.value0.value0);
  }
  ;
  return Nothing.value;
};
var partialName3 = function(v) {
  if (v instanceof App2 && v.value0 === "partial") {
    return litName(v.value1);
  }
  ;
  return Nothing.value;
};
var lint = function(tpl, dialect) {
  var surface = dialect === "fullbars";
  var opts = (function() {
    if (dialect === "maxbars") {
      return maxOptions;
    }
    ;
    if (dialect === "fullbars") {
      return defaultParseOptions;
    }
    ;
    return coreOptions;
  })();
  var v = parseWith(opts)(tpl);
  if (v instanceof Left) {
    return {
      ok: false,
      findings: [],
      report: "",
      error: renderParseErrorAt(tpl)(v.value0)
    };
  }
  ;
  if (v instanceof Right) {
    var locate = function(i) {
      return lineColumn(tpl)(i.span.start + fromMaybe(0)(indexOf2(i.name)(spanText(tpl)(i.span))) | 0);
    };
    var issues = append5(aliasWarnings(v.value0.nodes))((function() {
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
      findings: map26(function(i) {
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
        var $75 = $$null(issues);
        if ($75) {
          return "ok: no lint findings";
        }
        ;
        return joinWith("\n")(map26(fmt)(issues));
      })(),
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at FullBars.JS (line 154, column 5 - line 186, column 12): " + [v.constructor.name]);
};
var jsOperation = function(name2) {
  return function(fn) {
    return function(ctl) {
      return function(args) {
        var $78 = $$null(ctl.children);
        if ($78) {
          var v = callJsHelperImpl(name2)(fn)(map26(toJson)(args));
          if (v.tag === "safe") {
            return pure7(new VSafe(caseJsonString("")(identity10)(v.payload)));
          }
          ;
          if (v.tag === "arity") {
            return throwError2(new ArityError(caseJsonString("")(identity10)(v.payload)));
          }
          ;
          if (v.tag === "error") {
            return throwError2(new HelperError(caseJsonString("")(identity10)(v.payload)));
          }
          ;
          if (otherwise) {
            return pure7(fromJson(v.payload));
          }
          ;
          throw new Error("Failed pattern match at FullBars.JS (line 313, column 35 - line 318, column 47): " + [v.constructor.name]);
        }
        ;
        var optsFrame = function(optsJson) {
          var o = caseJsonObject(empty)(identity10)(optsJson);
          var dataObj = caseJsonObject(empty)(identity10)(fromMaybe(jsonNull)(lookup2("data")(o)));
          var dataMap = fromFoldable12(map26(function(v2) {
            return new Tuple(v2.value0, constOperation2(fromJson(v2.value1)));
          })(toUnfoldable9(dataObj)));
          var bpVals = caseJsonArray([])(identity10)(fromMaybe(jsonNull)(lookup2("blockParams")(o)));
          var bpMap = fromFoldable12(zipWith(function(n) {
            return function(v2) {
              return new Tuple(n, constOperation2(fromJson(v2)));
            };
          })(ctl.blockParams)(bpVals));
          return union8(bpMap)(dataMap);
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
                  error: show15(v2.value0)
                };
              }
              ;
              throw new Error("Failed pattern match at FullBars.JS (line 344, column 9 - line 346, column 60): " + [v2.constructor.name]);
            };
          };
        };
        var nDrop = length(ctl.blockParams) + (function() {
          var $86 = isJust(ctl.hash);
          if ($86) {
            return 1;
          }
          ;
          return 0;
        })() | 0;
        var forwardArgs = take(length(args) - nDrop | 0)(args);
        var clause = ctl.clause("else");
        var r = callJsBlockHelperImpl(name2)(fn)(map26(toJson)(forwardArgs))(toJson(refContext(ctl.env)))(maybe(jsonNull)(toJson)(ctl.hash))(renderClause(clause.before))(renderClause(fromMaybe([])(clause.body)));
        if (r.tag === "arity") {
          return throwError2(new ArityError(caseJsonString("")(identity10)(r.payload)));
        }
        ;
        if (r.tag === "error") {
          return throwError2(new HelperError(caseJsonString("")(identity10)(r.payload)));
        }
        ;
        return pure7(new VSafe(caseJsonString("")(identity10)(r.payload)));
      };
    };
  };
};
var marshalOps = /* @__PURE__ */ (function() {
  var $174 = map26(function(v) {
    return new Tuple(v.value0, jsOperation(v.value0)(v.value1));
  });
  return function($175) {
    return $174(toUnfoldable9($175));
  };
})();
var renderMaxWith = function(operations, partials, tpl, json) {
  return result(renderWithOperations(marshalOps(operations))(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderRawWith = function(operations, partials, tpl, json) {
  return result(renderWithOperations2(marshalOps(operations))(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderWith = function(helpers, partials, tpl, json) {
  return result(renderSurfaceWithHelpers(marshalOps(helpers))(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var $$int = function(n) {
  return id(toNumber(n));
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
    if (v === "maxbars") {
      return {
        lexConfig: {
          open: maxOptions.lexConfig.open,
          close: maxOptions.lexConfig.close,
          mustacheDelims: maxOptions.lexConfig.mustacheDelims,
          keepLongComments: true
        },
        clauseSeps: maxOptions.standaloneSeps,
        lexOptions: maxOptions.lexOptions,
        extras: false,
        inheritance: false,
        rawBlockHbs: false,
        rawBlockHash: true
      };
    }
    ;
    if (v === "rawbars") {
      return {
        lexConfig: {
          open: defaultLexConfig.open,
          close: defaultLexConfig.close,
          mustacheDelims: defaultLexConfig.mustacheDelims,
          keepLongComments: true
        },
        clauseSeps: kernelClauses,
        lexOptions: defaultLexOptions,
        extras: false,
        inheritance: false,
        rawBlockHbs: false,
        rawBlockHash: true
      };
    }
    ;
    if (v === "minbars") {
      return {
        lexConfig: withSetDelims,
        clauseSeps: [],
        lexOptions: defaultLexOptions,
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
      lexOptions: defaultLexOptions,
      extras: true,
      inheritance: false,
      rawBlockHbs: true,
      rawBlockHash: false
    };
  };
})();
var highlightSpans2 = function(tpl, dialect) {
  return highlightSpans(highlightConfig(dialect))(tpl);
};
var tokenize = function(tpl, dialect) {
  return tokenizeSpans(highlightConfig(dialect))(tpl);
};
var diagnostics = function(src, dialect) {
  var opts = (function() {
    if (dialect === "maxbars") {
      return maxOptions;
    }
    ;
    if (dialect === "minbars") {
      return minOptions;
    }
    ;
    if (dialect === "rawbars") {
      return coreOptions;
    }
    ;
    return defaultParseOptions;
  })();
  return map26(parseErrorAt(src))(parseRecovering(opts)(src).errors);
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
    throw new Error("Failed pattern match at FullBars.JS (line 451, column 23 - line 453, column 49): " + [v.constructor.name]);
  };
};
var compileSurface2 = function(tpl) {
  return compileResultAt(tpl)(compileSurface(tpl));
};
var compileMinbarsWithPartials = function(partials, tpl) {
  return compileResultAt(tpl)(compileMinJsWith(toUnfoldable9(partials))(tpl));
};
var compileMinbarsCompatWithPartials = function(partials, tpl) {
  return compileResultAt(tpl)(compileMinJsCompatWith(toUnfoldable9(partials))(tpl));
};
var compileMinbarsCompat = function(tpl) {
  return compileResultAt(tpl)(compileMinJsCompat(tpl));
};
var compileMinbars = function(tpl) {
  return compileResultAt(tpl)(compileMinJs(tpl));
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
    var $107 = elem9(v.value0)(dataVars);
    if ($107) {
      return obj([tt2(v.value0)]);
    }
    ;
    return obj([tt2("identifier"), new Tuple("name", str(v.value0))]);
  }
  ;
  if (v instanceof App2) {
    return obj([tt2("call"), new Tuple("name", str(v.value0)), new Tuple("args", arr(map26(argOf)(v.value1)))]);
  }
  ;
  throw new Error("Failed pattern match at FullBars.JS (line 691, column 9 - line 700, column 99): " + [v.constructor.name]);
};
var path = function(args) {
  var v = uncons(args);
  if (v instanceof Just && (v.value0.head instanceof App2 && (v.value0.head.value0 === "this" && v.value0.head.value1.length === 0))) {
    var $113 = $$null(v.value0.tail);
    if ($113) {
      return ctx("this");
    }
    ;
    return obj([tt2("path"), new Tuple("segments", arr(map26(segment)(v.value0.tail)))]);
  }
  ;
  return obj([tt2("call"), new Tuple("name", str("lookup")), new Tuple("args", arr(map26(argOf)(args)))]);
};
var argOf = function(e) {
  return obj([new Tuple("value", rexpr(e))]);
};
var $lazy_rnode = /* @__PURE__ */ $runtime_lazy6("rnode", "FullBars.JS", function() {
  var children = function(ns) {
    return arr(map26($lazy_rnode(667))(ns));
  };
  return function(v) {
    if (v instanceof RText) {
      return obj([tt2("text"), new Tuple("text", str(v.value0))]);
    }
    ;
    if (v instanceof ROut) {
      var v1 = partialName3(v.value1);
      if (v1 instanceof Just) {
        return obj([tt2("partial"), new Tuple("name", str(v1.value0))]);
      }
      ;
      if (v1 instanceof Nothing) {
        return obj([tt2("emit"), new Tuple("expr", rexpr(v.value1)), new Tuple("escape", str((function() {
          if (v.value0) {
            return "html";
          }
          ;
          return "none";
        })()))]);
      }
      ;
      throw new Error("Failed pattern match at FullBars.JS (line 641, column 21 - line 648, column 10): " + [v1.constructor.name]);
    }
    ;
    if (v instanceof RIf) {
      return obj([tt2("if"), new Tuple("cond", rexpr(v.value0)), new Tuple("then", children(v.value1)), new Tuple("else", children(v.value2))]);
    }
    ;
    if (v instanceof RUnless) {
      return obj([tt2("unless"), new Tuple("cond", rexpr(v.value0)), new Tuple("then", children(v.value1)), new Tuple("else", children(v.value2))]);
    }
    ;
    if (v instanceof REach) {
      return obj([tt2("each"), new Tuple("subject", rexpr(v.value0)), new Tuple("body", children(v.value1)), new Tuple("else", children(v.value2))]);
    }
    ;
    if (v instanceof RWith) {
      return obj([tt2("with"), new Tuple("subject", rexpr(v.value0)), new Tuple("body", children(v.value1)), new Tuple("else", children(v.value2))]);
    }
    ;
    var v1 = function(v2) {
      var v3 = function(v4) {
        if (v instanceof RCall) {
          return obj([tt2(v.value0), new Tuple("args", arr(map26(argOf)(v.value1))), new Tuple("body", children(v.value2))]);
        }
        ;
        if (v instanceof RSep2) {
          return obj([tt2("sep"), new Tuple("name", str(v.value0)), new Tuple("args", arr(map26(argOf)(v.value1)))]);
        }
        ;
        if (v instanceof RRaw2) {
          return obj([tt2("raw"), new Tuple("text", str(v.value0))]);
        }
        ;
        throw new Error("Failed pattern match at FullBars.JS (line 636, column 1 - line 636, column 23): " + [v.constructor.name]);
      };
      if (v instanceof RCall && v.value0 === "partial") {
        var $146 = litName(v.value1);
        if ($146 instanceof Just) {
          return obj([tt2("partial"), new Tuple("name", str($146.value0)), new Tuple("body", children(v.value2))]);
        }
        ;
        return v3(true);
      }
      ;
      return v3(true);
    };
    if (v instanceof RCall && v.value0 === "inline") {
      var $152 = litName(v.value1);
      if ($152 instanceof Just) {
        return obj([tt2("inline"), new Tuple("name", str($152.value0)), new Tuple("body", children(v.value2))]);
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
});
var rnode = /* @__PURE__ */ $lazy_rnode(636);
var astJson = function(dialect, src) {
  var errObj = function(pe) {
    var d = parseErrorAt(src)(pe);
    return obj([new Tuple("error", obj([new Tuple("message", str(d.message)), new Tuple("start", $$int(d.offset)), new Tuple("end", $$int(d.offset))]))]);
  };
  var v = (function() {
    var $157 = dialect === "maxbars";
    if ($157) {
      return parseWith(maxOptions);
    }
    ;
    return parse;
  })()(src);
  if (v instanceof Left) {
    return errObj(v.value0);
  }
  ;
  var v1 = function(v2) {
    if (v instanceof Right) {
      var desugared = (function() {
        if (dialect === "core") {
          return v.value0.nodes;
        }
        ;
        if (dialect === "maxbars") {
          return desugarSurfaceWith(maxLoopVars)(v.value0.nodes);
        }
        ;
        return desugarSurface(v.value0.nodes);
      })();
      var nodes = lower(desugared);
      return obj([new Tuple("ast", obj([new Tuple("version", str("flatbars-ast/v1")), new Tuple("nodes", arr(map26(rnode)(nodes)))]))]);
    }
    ;
    throw new Error("Failed pattern match at FullBars.JS (line 565, column 1 - line 565, column 34): " + [v.constructor.name]);
  };
  if (v instanceof Right) {
    var $165 = dialect !== "core";
    if ($165) {
      var $166 = dialect !== "maxbars";
      if ($166) {
        var $167 = checkBareInline(true)(v.value0.nodes);
        if ($167 instanceof Left) {
          return errObj($167.value0);
        }
        ;
        return v1(true);
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
var analyze = function(tpl, json) {
  var v = analyseSurface(tpl)(fromJson(json));
  if (v instanceof Left) {
    return {
      ok: false,
      findings: [],
      report: "",
      jsonata: "",
      output: "",
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
      error: ""
    };
  }
  ;
  throw new Error("Failed pattern match at FullBars.JS (line 116, column 30 - line 125, column 6): " + [v.constructor.name]);
};
export {
  analyze,
  astJson,
  compile2 as compile,
  compileFor,
  compileMaxbars,
  compileMinbars,
  compileMinbarsCompat,
  compileMinbarsCompatWithPartials,
  compileMinbarsWithPartials,
  compileSurface2 as compileSurface,
  diagnostics,
  highlightSpans2 as highlightSpans,
  lint,
  migrate,
  render,
  renderMaxWith,
  renderMaxbars,
  renderMinbars,
  renderMinbarsCompat,
  renderMinbarsCompatWithPartials,
  renderMustache,
  renderRawWith,
  renderSurface,
  renderSurfaceWithPartials,
  renderWith,
  safe,
  tokenize
};
