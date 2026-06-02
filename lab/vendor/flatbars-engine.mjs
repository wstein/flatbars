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
var callJsBlockHelperImpl = (name2) => (descriptor) => (args) => (currentCtx) => (renderBody) => (renderInverse) => {
  const fn = typeof descriptor === "function" ? descriptor : descriptor.fn;
  const arity = typeof descriptor === "function" ? void 0 : descriptor.arity;
  if (!arityOk(arity, args.length)) {
    return { tag: "arity", payload: name2 + ": expected " + arityText(arity) + " argument(s), got " + args.length };
  }
  const unwrap2 = (r) => {
    if (!r.ok) throw new Error(r.error);
    return r.value;
  };
  const options = {
    fn: function(ctx2) {
      return unwrap2(renderBody(arguments.length === 0 ? currentCtx : ctx2));
    },
    inverse: function(ctx2) {
      return unwrap2(renderInverse(arguments.length === 0 ? currentCtx : ctx2));
    }
  };
  for (const k of ["hash", "data", "blockParams", "ids", "loc", "lookupProperty"]) {
    Object.defineProperty(options, k, {
      get() {
        throw new Error("options." + k + " is not supported in a FlatBars block helper (v1)");
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
var applyArray = {
  apply: arrayApply,
  Functor0: function() {
    return functorArray;
  }
};
var apply = function(dict) {
  return dict.apply;
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
var identity2 = /* @__PURE__ */ identity(categoryFn);
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
    return bind12(m)(identity2);
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
  var eq35 = eq(dictEq);
  return function(x) {
    return function(y) {
      return eq2(eq35(x)(y))(false);
    };
  };
};

// output/Data.Ordering/index.js
var LT = /* @__PURE__ */ function() {
  function LT2() {
  }
  ;
  LT2.value = new LT2();
  return LT2;
}();
var GT = /* @__PURE__ */ function() {
  function GT2() {
  }
  ;
  GT2.value = new GT2();
  return GT2;
}();
var EQ = /* @__PURE__ */ function() {
  function EQ2() {
  }
  ;
  EQ2.value = new EQ2();
  return EQ2;
}();
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
var ordString = /* @__PURE__ */ function() {
  return {
    compare: ordStringImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqString;
    }
  };
}();
var ordNumber = /* @__PURE__ */ function() {
  return {
    compare: ordNumberImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqNumber;
    }
  };
}();
var ordInt = /* @__PURE__ */ function() {
  return {
    compare: ordIntImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqInt;
    }
  };
}();
var ordChar = /* @__PURE__ */ function() {
  return {
    compare: ordCharImpl(LT.value)(EQ.value)(GT.value),
    Eq0: function() {
      return eqChar;
    }
  };
}();
var compare = function(dict) {
  return dict.compare;
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
var show = function(dict) {
  return dict.show;
};

// output/Data.Maybe/index.js
var identity3 = /* @__PURE__ */ identity(categoryFn);
var Nothing = /* @__PURE__ */ function() {
  function Nothing2() {
  }
  ;
  Nothing2.value = new Nothing2();
  return Nothing2;
}();
var Just = /* @__PURE__ */ function() {
  function Just2(value0) {
    this.value0 = value0;
  }
  ;
  Just2.create = function(value0) {
    return new Just2(value0);
  };
  return Just2;
}();
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
  return maybe(a)(identity3);
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
var Left = /* @__PURE__ */ function() {
  function Left2(value0) {
    this.value0 = value0;
  }
  ;
  Left2.create = function(value0) {
    return new Left2(value0);
  };
  return Left2;
}();
var Right = /* @__PURE__ */ function() {
  function Right2(value0) {
    this.value0 = value0;
  }
  ;
  Right2.create = function(value0) {
    return new Right2(value0);
  };
  return Right2;
}();
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
var applicativeEither = /* @__PURE__ */ function() {
  return {
    pure: Right.create,
    Apply0: function() {
      return applyEither;
    }
  };
}();
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
  var pure5 = pure(dictMonad.Applicative0());
  return function(f) {
    return function(a) {
      return bind9(f)(function(f$prime) {
        return bind9(a)(function(a$prime) {
          return pure5(f$prime(a$prime));
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
var mempty = function(dict) {
  return dict.mempty;
};
var power = function(dictMonoid) {
  var mempty1 = mempty(dictMonoid);
  var append3 = append(dictMonoid.Semigroup0());
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
        return append3(x$prime)(x$prime);
      }
      ;
      if (otherwise) {
        var x$prime = go(div2(p)(2));
        return append3(x$prime)(append3(x$prime)(x));
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
var monadThrowEither = /* @__PURE__ */ function() {
  return {
    throwError: Left.create,
    Monad0: function() {
      return monadEither;
    }
  };
}();

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
function runST(f) {
  return f();
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
var $runtime_lazy = function(name2, moduleName, init) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init();
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
var fromFoldableImpl = /* @__PURE__ */ function() {
  function Cons2(head3, tail) {
    this.head = head3;
    this.tail = tail;
  }
  var emptyList = {};
  function curryCons(head3) {
    return function(tail) {
      return new Cons2(head3, tail);
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
}();
var length = function(xs) {
  return xs.length;
};
var unconsImpl = function(empty5, next, xs) {
  return xs.length === 0 ? empty5({}) : next(xs[0])(xs.slice(1));
};
var indexImpl = function(just, nothing, xs, i) {
  return i < 0 || i >= xs.length ? nothing : just(xs[i]);
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
var sortByImpl = /* @__PURE__ */ function() {
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
}();
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
  return function(init) {
    return function(xs) {
      var acc = init;
      var len = xs.length;
      for (var i = len - 1; i >= 0; i--) {
        acc = f(xs[i])(acc);
      }
      return acc;
    };
  };
};
var foldlArray = function(f) {
  return function(init) {
    return function(xs) {
      var acc = init;
      var len = xs.length;
      for (var i = 0; i < len; i++) {
        acc = f(acc)(xs[i]);
      }
      return acc;
    };
  };
};

// output/Data.Tuple/index.js
var Tuple = /* @__PURE__ */ function() {
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
}();
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
var identity4 = /* @__PURE__ */ identity(categoryFn);
var bimap = function(dict) {
  return dict.bimap;
};
var lmap = function(dictBifunctor) {
  var bimap1 = bimap(dictBifunctor);
  return function(f) {
    return bimap1(f)(identity4);
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
var alaF2 = /* @__PURE__ */ alaF()()()();
var foldr = function(dict) {
  return dict.foldr;
};
var foldl = function(dict) {
  return dict.foldl;
};
var foldMapDefaultR = function(dictFoldable) {
  var foldr2 = foldr(dictFoldable);
  return function(dictMonoid) {
    var append3 = append(dictMonoid.Semigroup0());
    var mempty2 = mempty(dictMonoid);
    return function(f) {
      return foldr2(function(x) {
        return function(acc) {
          return append3(f(x))(acc);
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
var traverseArrayImpl = /* @__PURE__ */ function() {
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
  return function(apply2) {
    return function(map25) {
      return function(pure5) {
        return function(f) {
          return function(array) {
            function go(bot, top3) {
              switch (top3 - bot) {
                case 0:
                  return pure5([]);
                case 1:
                  return map25(array1)(f(array[bot]));
                case 2:
                  return apply2(map25(array2)(f(array[bot])))(f(array[bot + 1]));
                case 3:
                  return apply2(apply2(map25(array3)(f(array[bot])))(f(array[bot + 1])))(f(array[bot + 2]));
                default:
                  var pivot = bot + Math.floor((top3 - bot) / 4) * 2;
                  return apply2(map25(concat2)(go(bot, pivot)))(go(pivot, top3));
              }
            }
            return go(0, array.length);
          };
        };
      };
    };
  };
}();

// output/Data.Traversable/index.js
var identity5 = /* @__PURE__ */ identity(categoryFn);
var traverse = function(dict) {
  return dict.traverse;
};
var sequenceDefault = function(dictTraversable) {
  var traverse22 = traverse(dictTraversable);
  return function(dictApplicative) {
    return traverse22(dictApplicative)(identity5);
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
  return function(fromJust4) {
    return function(fst2) {
      return function(snd2) {
        return function(f) {
          return function(b) {
            var result2 = [];
            var value = b;
            while (true) {
              var maybe2 = f(value);
              if (isNothing2(maybe2)) return result2;
              var tuple = fromJust4(maybe2);
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
  return function(fromJust4) {
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
              value = fromJust4(maybe2);
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
var map4 = /* @__PURE__ */ map(functorMaybe);
var map22 = /* @__PURE__ */ map(functorST);
var when2 = /* @__PURE__ */ when(applicativeST);
var append2 = /* @__PURE__ */ append(semigroupArray);
var zipWith = /* @__PURE__ */ runFn3(zipWithImpl);
var unsafeIndex = function() {
  return runFn2(unsafeIndexImpl);
};
var unsafeIndex1 = /* @__PURE__ */ unsafeIndex();
var uncons = /* @__PURE__ */ function() {
  return runFn3(unconsImpl)($$const(Nothing.value))(function(x) {
    return function(xs) {
      return new Just({
        head: x,
        tail: xs
      });
    };
  });
}();
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
var $$null = function(xs) {
  return length(xs) === 0;
};
var mapWithIndex2 = /* @__PURE__ */ mapWithIndex(functorWithIndexArray);
var index = /* @__PURE__ */ function() {
  return runFn4(indexImpl)(Just.create)(Nothing.value);
}();
var last = function(xs) {
  return index(xs)(length(xs) - 1 | 0);
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
var findLastIndex = /* @__PURE__ */ function() {
  return runFn4(findLastIndexImpl)(Just.create)(Nothing.value);
}();
var findIndex = /* @__PURE__ */ function() {
  return runFn4(findIndexImpl)(Just.create)(Nothing.value);
}();
var find2 = function(f) {
  return function(xs) {
    return map4(unsafeIndex1(xs))(findIndex(f)(xs));
  };
};
var filter = /* @__PURE__ */ runFn2(filterImpl);
var elemIndex = function(dictEq) {
  var eq22 = eq(dictEq);
  return function(x) {
    return findIndex(function(v) {
      return eq22(v)(x);
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
  return concatMap(function() {
    var $189 = maybe([])(singleton2);
    return function($190) {
      return $189(f($190));
    };
  }());
};
var any2 = /* @__PURE__ */ runFn2(anyImpl);
var nubByEq = function(eq22) {
  return function(xs) {
    return function __do() {
      var arr2 = newSTArray();
      foreach(xs)(function(x) {
        return function __do2() {
          var e = map22(function() {
            var $194 = any2(function(v) {
              return eq22(v)(x);
            });
            return function($195) {
              return !$194($195);
            };
          }())(unsafeFreeze(arr2))();
          return when2(e)($$void2(push(x)(arr2)))();
        };
      })();
      return unsafeFreeze(arr2)();
    }();
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
var fromStringAs = /* @__PURE__ */ function() {
  return fromStringAsImpl(Just.create)(Nothing.value);
}();
var fromString2 = /* @__PURE__ */ fromStringAs(10);
var fromNumber = /* @__PURE__ */ function() {
  return fromNumberImpl(Just.create)(Nothing.value);
}();
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
var Nil = /* @__PURE__ */ function() {
  function Nil2() {
  }
  ;
  Nil2.value = new Nil2();
  return Nil2;
}();
var Cons = /* @__PURE__ */ function() {
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
}();
var foldableList = {
  foldr: function(f) {
    return function(b) {
      var rev = function() {
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
      }();
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
var $runtime_lazy2 = function(name2, moduleName, init) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init();
    state2 = 2;
    return val;
  };
};
var Leaf = /* @__PURE__ */ function() {
  function Leaf2() {
  }
  ;
  Leaf2.value = new Leaf2();
  return Leaf2;
}();
var Node = /* @__PURE__ */ function() {
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
}();
var IterLeaf = /* @__PURE__ */ function() {
  function IterLeaf2() {
  }
  ;
  IterLeaf2.value = new IterLeaf2();
  return IterLeaf2;
}();
var IterEmit = /* @__PURE__ */ function() {
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
}();
var IterNode = /* @__PURE__ */ function() {
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
}();
var IterDone = /* @__PURE__ */ function() {
  function IterDone2() {
  }
  ;
  IterDone2.value = new IterDone2();
  return IterDone2;
}();
var IterNext = /* @__PURE__ */ function() {
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
}();
var Split = /* @__PURE__ */ function() {
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
}();
var SplitLast = /* @__PURE__ */ function() {
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
}();
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
      return new Node(1 + function() {
        var $280 = l.value0 > r.value0;
        if ($280) {
          return l.value0;
        }
        ;
        return r.value0;
      }() | 0, (1 + l.value1 | 0) + r.value1 | 0, k, v, l, r);
    }
    ;
    throw new Error("Failed pattern match at Data.Map.Internal (line 708, column 5 - line 712, column 68): " + [r.constructor.name]);
  }
  ;
  throw new Error("Failed pattern match at Data.Map.Internal (line 700, column 32 - line 712, column 68): " + [l.constructor.name]);
};
var toMapIter = /* @__PURE__ */ function() {
  return flip(IterNode.create)(IterLeaf.value);
}();
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
var unsafeBalancedNode = /* @__PURE__ */ function() {
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
}();
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
var member = function(dictOrd) {
  var compare3 = compare(dictOrd);
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
var lookup = function(dictOrd) {
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
var iterMapL = /* @__PURE__ */ function() {
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
}();
var stepAscCps = /* @__PURE__ */ stepWith(iterMapL);
var stepAsc = /* @__PURE__ */ function() {
  return stepAscCps(function(k, v, next) {
    return new IterNext(k, v, next);
  })($$const(IterDone.value));
}();
var eqMapIter = function(dictEq) {
  var eq15 = eq(dictEq);
  return function(dictEq1) {
    var eq22 = eq(dictEq1);
    return {
      eq: /* @__PURE__ */ function() {
        var go = function($copy_a) {
          return function($copy_b) {
            var $tco_var_a = $copy_a;
            var $tco_done = false;
            var $tco_result;
            function $tco_loop(a, b) {
              var v = stepAsc(a);
              if (v instanceof IterNext) {
                var v2 = stepAsc(b);
                if (v2 instanceof IterNext && (eq15(v.value0)(v2.value0) && eq22(v.value1)(v2.value1))) {
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
      }()
    };
  };
};
var stepUnfoldr = /* @__PURE__ */ function() {
  var step = function(k, v, next) {
    return new Just(new Tuple(new Tuple(k, v), next));
  };
  return stepAscCps(step)(function(v) {
    return Nothing.value;
  });
}();
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
var empty3 = /* @__PURE__ */ function() {
  return Leaf.value;
}();
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
var $$delete = function(dictOrd) {
  var compare3 = compare(dictOrd);
  return function(k) {
    var go = function(v) {
      if (v instanceof Leaf) {
        return Leaf.value;
      }
      ;
      if (v instanceof Node) {
        var v1 = compare3(k)(v.value2);
        if (v1 instanceof LT) {
          return unsafeBalancedNode(v.value2, v.value3, go(v.value4), v.value5);
        }
        ;
        if (v1 instanceof GT) {
          return unsafeBalancedNode(v.value2, v.value3, v.value4, go(v.value5));
        }
        ;
        if (v1 instanceof EQ) {
          return unsafeJoinNodes(v.value4, v.value5);
        }
        ;
        throw new Error("Failed pattern match at Data.Map.Internal (line 498, column 7 - line 501, column 43): " + [v1.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at Data.Map.Internal (line 495, column 8 - line 501, column 43): " + [v.constructor.name]);
    };
    return go;
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
var indexOf = /* @__PURE__ */ function() {
  return _indexOf(Just.create)(Nothing.value);
}();
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

// output/FlatBars.Span/index.js
var lineColumn = function(src) {
  return function(offset) {
    var cs = toCharArray(take2(offset)(src));
    var nls = length(filter(function(v) {
      return v === "\n";
    })(cs));
    var col = function() {
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
    }();
    return {
      line: nls + 1 | 0,
      column: col
    };
  };
};

// output/FlatBars.Error/index.js
var show2 = /* @__PURE__ */ show(showInt);
var UnterminatedTag = /* @__PURE__ */ function() {
  function UnterminatedTag2(value0) {
    this.value0 = value0;
  }
  ;
  UnterminatedTag2.create = function(value0) {
    return new UnterminatedTag2(value0);
  };
  return UnterminatedTag2;
}();
var UnterminatedComment = /* @__PURE__ */ function() {
  function UnterminatedComment2(value0) {
    this.value0 = value0;
  }
  ;
  UnterminatedComment2.create = function(value0) {
    return new UnterminatedComment2(value0);
  };
  return UnterminatedComment2;
}();
var UnterminatedRaw = /* @__PURE__ */ function() {
  function UnterminatedRaw2(value0) {
    this.value0 = value0;
  }
  ;
  UnterminatedRaw2.create = function(value0) {
    return new UnterminatedRaw2(value0);
  };
  return UnterminatedRaw2;
}();
var MismatchedBlock = /* @__PURE__ */ function() {
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
}();
var HeadNotIdent = /* @__PURE__ */ function() {
  function HeadNotIdent2(value0) {
    this.value0 = value0;
  }
  ;
  HeadNotIdent2.create = function(value0) {
    return new HeadNotIdent2(value0);
  };
  return HeadNotIdent2;
}();
var EmptyOutput = /* @__PURE__ */ function() {
  function EmptyOutput2(value0) {
    this.value0 = value0;
  }
  ;
  EmptyOutput2.create = function(value0) {
    return new EmptyOutput2(value0);
  };
  return EmptyOutput2;
}();
var BadEscape = /* @__PURE__ */ function() {
  function BadEscape2(value0) {
    this.value0 = value0;
  }
  ;
  BadEscape2.create = function(value0) {
    return new BadEscape2(value0);
  };
  return BadEscape2;
}();
var LexError = /* @__PURE__ */ function() {
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
}();
var DirectiveAfterHeader = /* @__PURE__ */ function() {
  function DirectiveAfterHeader2(value0) {
    this.value0 = value0;
  }
  ;
  DirectiveAfterHeader2.create = function(value0) {
    return new DirectiveAfterHeader2(value0);
  };
  return DirectiveAfterHeader2;
}();
var BadDirective = /* @__PURE__ */ function() {
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
}();
var DisallowedShape = /* @__PURE__ */ function() {
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
}();
var UnknownHelper = /* @__PURE__ */ function() {
  function UnknownHelper2(value0) {
    this.value0 = value0;
  }
  ;
  UnknownHelper2.create = function(value0) {
    return new UnknownHelper2(value0);
  };
  return UnknownHelper2;
}();
var ArityError = /* @__PURE__ */ function() {
  function ArityError2(value0) {
    this.value0 = value0;
  }
  ;
  ArityError2.create = function(value0) {
    return new ArityError2(value0);
  };
  return ArityError2;
}();
var $$TypeError = /* @__PURE__ */ function() {
  function $$TypeError2(value0) {
    this.value0 = value0;
  }
  ;
  $$TypeError2.create = function(value0) {
    return new $$TypeError2(value0);
  };
  return $$TypeError2;
}();
var ClauseError = /* @__PURE__ */ function() {
  function ClauseError2(value0) {
    this.value0 = value0;
  }
  ;
  ClauseError2.create = function(value0) {
    return new ClauseError2(value0);
  };
  return ClauseError2;
}();
var HelperError = /* @__PURE__ */ function() {
  function HelperError2(value0) {
    this.value0 = value0;
  }
  ;
  HelperError2.create = function(value0) {
    return new HelperError2(value0);
  };
  return HelperError2;
}();
var RecursionLimit = /* @__PURE__ */ function() {
  function RecursionLimit2(value0) {
    this.value0 = value0;
  }
  ;
  RecursionLimit2.create = function(value0) {
    return new RecursionLimit2(value0);
  };
  return RecursionLimit2;
}();
var DirectiveError = /* @__PURE__ */ function() {
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
}();
var ParseFailure = /* @__PURE__ */ function() {
  function ParseFailure2(value0) {
    this.value0 = value0;
  }
  ;
  ParseFailure2.create = function(value0) {
    return new ParseFailure2(value0);
  };
  return ParseFailure2;
}();
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
  throw new Error("Failed pattern match at FlatBars.Error (line 132, column 15 - line 140, column 61): " + [v.constructor.name]);
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
var reverse2 = /* @__PURE__ */ function() {
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
}();
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
var VString = /* @__PURE__ */ function() {
  function VString2(value0) {
    this.value0 = value0;
  }
  ;
  VString2.create = function(value0) {
    return new VString2(value0);
  };
  return VString2;
}();
var VNumber = /* @__PURE__ */ function() {
  function VNumber2(value0) {
    this.value0 = value0;
  }
  ;
  VNumber2.create = function(value0) {
    return new VNumber2(value0);
  };
  return VNumber2;
}();
var VBool = /* @__PURE__ */ function() {
  function VBool2(value0) {
    this.value0 = value0;
  }
  ;
  VBool2.create = function(value0) {
    return new VBool2(value0);
  };
  return VBool2;
}();
var VNull = /* @__PURE__ */ function() {
  function VNull2() {
  }
  ;
  VNull2.value = new VNull2();
  return VNull2;
}();
var VArray = /* @__PURE__ */ function() {
  function VArray2(value0) {
    this.value0 = value0;
  }
  ;
  VArray2.create = function(value0) {
    return new VArray2(value0);
  };
  return VArray2;
}();
var VObject = /* @__PURE__ */ function() {
  function VObject2(value0) {
    this.value0 = value0;
  }
  ;
  VObject2.create = function(value0) {
    return new VObject2(value0);
  };
  return VObject2;
}();
var VSafe = /* @__PURE__ */ function() {
  function VSafe2(value0) {
    this.value0 = value0;
  }
  ;
  VSafe2.create = function(value0) {
    return new VSafe2(value0);
  };
  return VSafe2;
}();
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
var Section = /* @__PURE__ */ function() {
  function Section2() {
  }
  ;
  Section2.value = new Section2();
  return Section2;
}();
var Inverse = /* @__PURE__ */ function() {
  function Inverse2() {
  }
  ;
  Inverse2.value = new Inverse2();
  return Inverse2;
}();
var Parent = /* @__PURE__ */ function() {
  function Parent2() {
  }
  ;
  Parent2.value = new Parent2();
  return Parent2;
}();
var BlockDef = /* @__PURE__ */ function() {
  function BlockDef2() {
  }
  ;
  BlockDef2.value = new BlockDef2();
  return BlockDef2;
}();
var Lit = /* @__PURE__ */ function() {
  function Lit2(value0) {
    this.value0 = value0;
  }
  ;
  Lit2.create = function(value0) {
    return new Lit2(value0);
  };
  return Lit2;
}();
var App2 = /* @__PURE__ */ function() {
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
}();
var Content = /* @__PURE__ */ function() {
  function Content2(value0) {
    this.value0 = value0;
  }
  ;
  Content2.create = function(value0) {
    return new Content2(value0);
  };
  return Content2;
}();
var Output = /* @__PURE__ */ function() {
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
}();
var Block = /* @__PURE__ */ function() {
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
}();
var RawBlock = /* @__PURE__ */ function() {
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
}();
var Sep = /* @__PURE__ */ function() {
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
}();
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
      return false;
    };
  }
};

// output/FlatBars.Lexer/index.js
var eq12 = /* @__PURE__ */ eq(/* @__PURE__ */ eqArray(eqChar));
var notEq2 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var elem3 = /* @__PURE__ */ elem2(eqChar);
var fromFoldable4 = /* @__PURE__ */ fromFoldable(foldableList);
var bind2 = /* @__PURE__ */ bind(bindMaybe);
var map5 = /* @__PURE__ */ map(functorEither);
var elem1 = /* @__PURE__ */ elem2(eqString);
var RContent = /* @__PURE__ */ function() {
  function RContent2(value0) {
    this.value0 = value0;
  }
  ;
  RContent2.create = function(value0) {
    return new RContent2(value0);
  };
  return RContent2;
}();
var ROutput = /* @__PURE__ */ function() {
  function ROutput2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  ROutput2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new ROutput2(value0, value1, value2);
      };
    };
  };
  return ROutput2;
}();
var RAmp = /* @__PURE__ */ function() {
  function RAmp2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RAmp2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RAmp2(value0, value1, value2);
      };
    };
  };
  return RAmp2;
}();
var ROpen = /* @__PURE__ */ function() {
  function ROpen2(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  ROpen2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new ROpen2(value0, value1, value2, value3);
        };
      };
    };
  };
  return ROpen2;
}();
var RClose = /* @__PURE__ */ function() {
  function RClose2(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RClose2.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RClose2(value0, value1, value2);
      };
    };
  };
  return RClose2;
}();
var RSep = /* @__PURE__ */ function() {
  function RSep3(value0, value1, value2) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
  }
  ;
  RSep3.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return new RSep3(value0, value1, value2);
      };
    };
  };
  return RSep3;
}();
var RRaw = /* @__PURE__ */ function() {
  function RRaw3(value0, value1, value2, value3) {
    this.value0 = value0;
    this.value1 = value1;
    this.value2 = value2;
    this.value3 = value3;
  }
  ;
  RRaw3.create = function(value0) {
    return function(value1) {
      return function(value2) {
        return function(value3) {
          return new RRaw3(value0, value1, value2, value3);
        };
      };
    };
  };
  return RRaw3;
}();
var RComment = /* @__PURE__ */ function() {
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
}();
var RSetDelim = /* @__PURE__ */ function() {
  function RSetDelim2(value0) {
    this.value0 = value0;
  }
  ;
  RSetDelim2.create = function(value0) {
    return new RSetDelim2(value0);
  };
  return RSetDelim2;
}();
var RLongComment = /* @__PURE__ */ function() {
  function RLongComment2(value0) {
    this.value0 = value0;
  }
  ;
  RLongComment2.create = function(value0) {
    return new RLongComment2(value0);
  };
  return RLongComment2;
}();
var slice3 = function(cs) {
  return function(i) {
    return function(j) {
      return fromCharArray(slice(i)(j)(cs));
    };
  };
};
var nlIndex = function(first) {
  return function(s) {
    var f = function() {
      if (first) {
        return findIndex;
      }
      ;
      return findLastIndex;
    }();
    return f(function(v) {
      return v === "\n";
    })(toCharArray(s));
  };
};
var matchAt = function(cs) {
  return function(i) {
    return function(pat) {
      var pcs = toCharArray(pat);
      return eq12(slice(i)(i + length(pcs) | 0)(cs))(pcs);
    };
  };
};
var isSpace = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var sepHead = function(s) {
  var cs = dropWhile(isSpace)(toCharArray(s));
  return fromCharArray(takeWhile(function($333) {
    return !isSpace($333);
  })(cs));
};
var trimEndWs = function(s) {
  return fromCharArray(reverse(dropWhile(isSpace)(reverse(toCharArray(s)))));
};
var trimStartWs = function(s) {
  return fromCharArray(dropWhile(isSpace)(toCharArray(s)));
};
var hasNL = function(s) {
  return notEq2(nlIndex(true)(s))(Nothing.value);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 98, column 3 - line 101, column 29): " + [i.constructor.name]);
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
      return !elem3("=")(toCharArray(d));
    };
    var splitTrims = function(raw) {
      var trimL = take2(1)(raw) === "~";
      var r1 = function() {
        if (trimL) {
          return drop2(1)(raw);
        }
        ;
        return raw;
      }();
      var trimR = takeRight(1)(r1) === "~";
      var core = function() {
        if (trimR) {
          return dropRight(1)(r1);
        }
        ;
        return r1;
      }();
      return {
        trimL,
        trimR,
        core
      };
    };
    var rawName = function(s) {
      return fromCharArray(takeWhile(function($334) {
        return !isSpace($334);
      })(dropWhile(isSpace)(toCharArray(s))));
    };
    var flush = function(s0) {
      return function(acc) {
        return function(pend) {
          return function(trimR) {
            var s1 = function() {
              if (pend) {
                return trimStartWs(s0);
              }
              ;
              return s0;
            }();
            var s2 = function() {
              if (trimR) {
                return trimEndWs(s1);
              }
              ;
              return s1;
            }();
            var $150 = s2 === "";
            if ($150) {
              return acc;
            }
            ;
            return new Cons(new RContent(s2), acc);
          };
        };
      };
    };
    var finalize = function($335) {
      return fromFoldable4(reverse2($335));
    };
    var delimWords = function(s) {
      var a0 = dropWhile(isSpace)(toCharArray(s));
      var a1 = dropWhile(isSpace)(dropWhile(function($336) {
        return !isSpace($336);
      })(a0));
      var rest = dropWhile(isSpace)(dropWhile(function($337) {
        return !isSpace($337);
      })(a1));
      var w2 = takeWhile(function($338) {
        return !isSpace($338);
      })(a1);
      var w1 = takeWhile(function($339) {
        return !isSpace($339);
      })(a0);
      var $151 = $$null(w1) || ($$null(w2) || !$$null(rest));
      if ($151) {
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
      var v = bind2(stripPrefix("@delimiters")(t))(function() {
        var $340 = stripPrefix(":");
        return function($341) {
          return $340(trimStartWs($341));
        };
      }());
      if (v instanceof Nothing) {
        return Nothing.value;
      }
      ;
      if (v instanceof Just) {
        return new Just(function() {
          var v1 = delimWords(v.value0);
          if (v1 instanceof Just && (validDelim(v1.value0.open) && validDelim(v1.value0.close))) {
            return new Right(v1.value0);
          }
          ;
          return new Left(new LexError("@delimiters expects two whitespace-separated delimiters (no '=')", 0));
        }());
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 388, column 7 - line 395, column 100): " + [v.constructor.name]);
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 375, column 58 - line 378, column 39): " + [v1.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Lexer (line 420, column 3 - line 420, column 41): " + [i.constructor.name]);
    };
    var isSeparatorAt = function(i) {
      return matchAt(cs)(i)("{{") && (!matchAt(cs)(i)("{{{") && function() {
        var v = openerLiteralAt(i);
        if (v instanceof Just) {
          return false;
        }
        ;
        if (v instanceof Nothing) {
          return true;
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 449, column 70 - line 451, column 20): " + [v.constructor.name]);
      }());
    };
    var escapedOpenerAt = function(i) {
      var v = openerLiteralAt(i);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        var $171 = isSeparatorAt(i);
        if ($171) {
          return new Just("{{");
        }
        ;
        return Nothing.value;
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 460, column 23 - line 462, column 62): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Lexer (line 454, column 18 - line 456, column 31): " + [v.constructor.name]);
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
            }, start, t.core)),
            next: v.value0 + 2 | 0,
            trimL: leadTrimAt(i) || t.trimL,
            trimR: t.trimR
          });
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 572, column 7 - line 583, column 16): " + [v.constructor.name]);
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
                }, sigil, start, t.core)),
                next: v.value0 + cl | 0,
                trimL: leadTrimAt(i) || t.trimL,
                trimR: t.trimR
              });
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Lexer (line 532, column 7 - line 543, column 16): " + [v.constructor.name]);
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
              }, start, t.core)),
              next: v.value0 + cl | 0,
              trimL: leadTrimAt(i) || t.trimL,
              trimR: t.trimR
            });
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 553, column 7 - line 564, column 16): " + [v.constructor.name]);
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
            var v1 = index(cs)(start);
            if (v1 instanceof Just && v1.value0 === "#") {
              return mk(new ROpen(span2, Section.value, start + 1 | 0, afterSig));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "^") {
              return mk(new ROpen(span2, Inverse.value, start + 1 | 0, afterSig));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "<") {
              return mk(new ROpen(span2, Parent.value, start + 1 | 0, afterSig));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "$") {
              return mk(new ROpen(span2, BlockDef.value, start + 1 | 0, afterSig));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "/") {
              return mk(new RClose(span2, start + 1 | 0, afterSig));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "&") {
              return mk(new RAmp(span2, start + 1 | 0, afterSig));
            }
            ;
            if (v1 instanceof Just && v1.value0 === "!") {
              return mk(new RComment(span2, start + 1 | 0, afterSig));
            }
            ;
            return mk(new RSep(span2, start, interior));
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 736, column 7 - line 754, column 49): " + [v.constructor.name]);
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
            mtok: function() {
              if (cfg.keepLongComments) {
                return new Just(new RLongComment({
                  start: i,
                  end: v.value0 + 4 | 0
                }));
              }
              ;
              return Nothing.value;
            }(),
            next: v.value0 + 4 | 0,
            trimL: leadTrimAt(i),
            trimR: matchAt(cs)(v.value0 - 1 | 0)("~")
          });
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 634, column 30 - line 641, column 8): " + [v.constructor.name]);
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
          }, start, t.core)),
          next: v.value0 + 3 | 0,
          trimL: t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 510, column 7 - line 521, column 16): " + [v.constructor.name]);
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
              }, start, head3, slice3(cs)(bodyStart2)(v1.value0))),
              next: end,
              trimL: false,
              trimR: false
            });
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 661, column 13 - line 672, column 22): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at FlatBars.Lexer (line 650, column 7 - line 672, column 22): " + [v.constructor.name]);
      };
    };
    var readSeparator = function(i) {
      var start = function() {
        var $199 = leadTrimAt(i);
        if ($199) {
          return i + 3 | 0;
        }
        ;
        return i + 2 | 0;
      }();
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
          }, start, t.core)),
          next: v.value0 + 2 | 0,
          trimL: leadTrimAt(i) || t.trimL,
          trimR: t.trimR
        });
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Lexer (line 593, column 7 - line 604, column 16): " + [v.constructor.name]);
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
            throw new Error("Failed pattern match at FlatBars.Lexer (line 694, column 19 - line 705, column 88): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Lexer (line 691, column 7 - line 705, column 88): " + [v.constructor.name]);
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
          var interior = slice3(cs)(start)(function() {
            if (trimR) {
              return v.value0 - 1 | 0;
            }
            ;
            return v.value0;
          }());
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
        throw new Error("Failed pattern match at FlatBars.Lexer (line 615, column 7 - line 627, column 16): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Lexer (line 464, column 3 - line 464, column 48): " + [i.constructor.name]);
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
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 315, column 65 - line 321, column 82): " + [v1.constructor.name]);
                        }
                        ;
                        if (open === "{{" && (close === "}}" && v.value0 === "\\")) {
                          var $221 = matchAt(cs)(i + 1 | 0)("\\");
                          if ($221) {
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
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 329, column 20 - line 335, column 98): " + [v1.constructor.name]);
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
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 342, column 19 - line 345, column 92): " + [v2.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 336, column 74 - line 345, column 92): " + [v1.constructor.name]);
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
                            throw new Error("Failed pattern match at FlatBars.Lexer (line 355, column 19 - line 358, column 92): " + [v2.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Lexer (line 349, column 34 - line 358, column 92): " + [v1.constructor.name]);
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
                      throw new Error("Failed pattern match at FlatBars.Lexer (line 309, column 19 - line 359, column 71): " + [v.constructor.name]);
                    }
                    ;
                    throw new Error("Failed pattern match at FlatBars.Lexer (line 298, column 3 - line 306, column 39): " + [i.constructor.name, open.constructor.name, close.constructor.name, segStart.constructor.name, frags.constructor.name, acc.constructor.name, pend.constructor.name]);
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
    return map5(finalize)(go(0)(cfg.open)(cfg.close)(0)([])(Nil.value)(false));
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 238, column 24 - line 240, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 231, column 21 - line 233, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 224, column 19 - line 226, column 15): " + [v.constructor.name]);
};
var allWs = /* @__PURE__ */ function() {
  var $342 = all2(isSpace);
  return function($343) {
    return $342(toCharArray($343));
  };
}();
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
  throw new Error("Failed pattern match at FlatBars.Lexer (line 219, column 17 - line 221, column 15): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 178, column 17 - line 184, column 22): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Lexer (line 166, column 16 - line 172, column 22): " + [v.constructor.name]);
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
      return blockLevel(t) || function() {
        if (t instanceof RSep) {
          return elem1(sepHead(t.value2))(seps);
        }
        ;
        return false;
      }();
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
          var s1 = function() {
            var $330 = standaloneAt(j - 1 | 0);
            if ($330) {
              return dropLeadingLine(v.value0);
            }
            ;
            return v.value0;
          }();
          var s2 = function() {
            var $331 = standaloneAt(j + 1 | 0);
            if ($331) {
              return dropTrailingIndent(s1);
            }
            ;
            return s1;
          }();
          return new RContent(s2);
        }
        ;
        return v;
      };
    };
    return mapWithIndex2(trimContent)(toks);
  };
};

// output/FlatBars.Token/index.js
var eq13 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var TIdent = /* @__PURE__ */ function() {
  function TIdent2(value0) {
    this.value0 = value0;
  }
  ;
  TIdent2.create = function(value0) {
    return new TIdent2(value0);
  };
  return TIdent2;
}();
var TStr = /* @__PURE__ */ function() {
  function TStr2(value0) {
    this.value0 = value0;
  }
  ;
  TStr2.create = function(value0) {
    return new TStr2(value0);
  };
  return TStr2;
}();
var TNum = /* @__PURE__ */ function() {
  function TNum2(value0) {
    this.value0 = value0;
  }
  ;
  TNum2.create = function(value0) {
    return new TNum2(value0);
  };
  return TNum2;
}();
var TLParen = /* @__PURE__ */ function() {
  function TLParen2() {
  }
  ;
  TLParen2.value = new TLParen2();
  return TLParen2;
}();
var TRParen = /* @__PURE__ */ function() {
  function TRParen2() {
  }
  ;
  TRParen2.value = new TRParen2();
  return TRParen2;
}();
var TOp = /* @__PURE__ */ function() {
  function TOp2(value0) {
    this.value0 = value0;
  }
  ;
  TOp2.create = function(value0) {
    return new TOp2(value0);
  };
  return TOp2;
}();
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
      var push3 = function(acc) {
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
                      return go(j + 1 | 0)(push3(acc)(new TStr(fromCharArray(reverse(chars))))(start)(j + 1 | 0));
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
                        throw new Error("Failed pattern match at FlatBars.Token (line 162, column 23 - line 164, column 76): " + [v2.constructor.name]);
                      }
                      ;
                      if (v1 instanceof Nothing) {
                        $tco_done = true;
                        return new Left(new LexError("unterminated string", base + start | 0));
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Token (line 161, column 24 - line 165, column 76): " + [v1.constructor.name]);
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
                  throw new Error("Failed pattern match at FlatBars.Token (line 156, column 23 - line 166, column 60): " + [v.constructor.name]);
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
            return go(end)(push3(acc)(new TNum(v.value0))(start)(end));
          }
          ;
          if (v instanceof Nothing) {
            return new Left(new LexError("malformed number '" + (raw + "'"), base + start | 0));
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Token (line 145, column 7 - line 147, column 87): " + [v.constructor.name]);
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
              if (eq13(at(k))(new Just("]"))) {
                $tco_done2 = true;
                return new Just(k);
              }
              ;
              if (otherwise) {
                $copy_k = k + 1 | 0;
                return;
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Token (line 134, column 5 - line 137, column 39): " + [k.constructor.name]);
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
                throw new Error("Failed pattern match at FlatBars.Token (line 129, column 19 - line 131, column 71): " + [v1.constructor.name]);
              }
              ;
              if (v instanceof Just && identChar(v.value0)) {
                $copy_j = j + 1 | 0;
                return;
              }
              ;
              $tco_done3 = true;
              return go(j)(push3(acc)(new TIdent(slc(start)(j)))(start)(j));
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
            return go(i + 2 | 0)(push3(acc)(new TOp(s))(i)(i + 2 | 0));
          };
        };
      };
      var op1 = function(s) {
        return function(i) {
          return function(acc) {
            return go(i + 1 | 0)(push3(acc)(new TOp(s))(i)(i + 1 | 0));
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
                  $copy_acc = push3(acc)(TLParen.value)(i)(i + 1 | 0);
                  return;
                }
                ;
                if (v.value0 === ")") {
                  $tco_var_i = i + 1 | 0;
                  $copy_acc = push3(acc)(TRParen.value)(i)(i + 1 | 0);
                  return;
                }
                ;
                if (v.value0 === '"' || v.value0 === "'") {
                  $tco_done4 = true;
                  return readString(i)(v.value0)(acc);
                }
                ;
                if (v.value0 === "&") {
                  var $61 = eq13(at(i + 1 | 0))(new Just("&"));
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
                  var $62 = eq13(at(i + 1 | 0))(new Just("|"));
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
                  var $63 = eq13(at(i + 1 | 0))(new Just("="));
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
                  var $64 = eq13(at(i + 1 | 0))(new Just("="));
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
                  var $65 = eq13(at(i + 1 | 0))(new Just("="));
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
                  var $66 = eq13(at(i + 1 | 0))(new Just("="));
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
                  var $67 = eq13(at(i + 1 | 0))(new Just("?"));
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
              throw new Error("Failed pattern match at FlatBars.Token (line 92, column 19 - line 117, column 31): " + [v.constructor.name]);
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Token (line 89, column 3 - line 89, column 68): " + [i.constructor.name, acc.constructor.name]);
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

// output/FlatBars.Highlight/index.js
var eq14 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var elem4 = /* @__PURE__ */ elem2(eqString);
var tile = function(start) {
  return function(end) {
    return function(headKind) {
      return function(punches) {
        var gap = function(a) {
          return function(b) {
            return function(acc) {
              if (b > a) {
                return snoc(acc)({
                  from: a,
                  to: b,
                  kind: headKind
                });
              }
              ;
              if (otherwise) {
                return acc;
              }
              ;
              throw new Error("Failed pattern match at FlatBars.Highlight (line 121, column 3 - line 123, column 22): " + [a.constructor.name, b.constructor.name, acc.constructor.name]);
            };
          };
        };
        var step = function(st) {
          return function(p) {
            return {
              pos: p.to,
              acc: snoc(gap(st.pos)(p.from)(st.acc))(p)
            };
          };
        };
        var filled = foldl2(step)({
          pos: start,
          acc: []
        })(punches);
        return gap(filled.pos)(end)(filled.acc);
      };
    };
  };
};
var sigilKind = function(v) {
  if (v instanceof Section) {
    return "block-open";
  }
  ;
  if (v instanceof Inverse) {
    return "block-inverse";
  }
  ;
  if (v instanceof Parent) {
    return "block-parent";
  }
  ;
  if (v instanceof BlockDef) {
    return "block-decl";
  }
  ;
  throw new Error("Failed pattern match at FlatBars.Highlight (line 126, column 13 - line 130, column 27): " + [v.constructor.name]);
};
var notable = function(t) {
  var punch = function(kind) {
    return new Just({
      from: t.at,
      to: t.end,
      kind
    });
  };
  if (t.tok instanceof TOp) {
    return punch("operator");
  }
  ;
  if (t.tok instanceof TStr) {
    return punch("string");
  }
  ;
  if (t.tok instanceof TNum) {
    return punch("number");
  }
  ;
  return Nothing.value;
};
var isSpace2 = function(c) {
  return c === " " || (c === "	" || (c === "\n" || c === "\r"));
};
var trimmedChars = /* @__PURE__ */ function() {
  var $53 = dropWhile(isSpace2);
  return function($54) {
    return $53(toCharArray($54));
  };
}();
var isPartialHead = function(s) {
  return eq14(head(trimmedChars(s)))(new Just(">"));
};
var headWord = function(s) {
  return fromCharArray(takeWhile(function($55) {
    return !isSpace2($55);
  })(trimmedChars(s)));
};
var highlightSpans = function(cfg) {
  return function(src) {
    var whole = function(sp) {
      return function(kind) {
        return {
          from: sp.start,
          to: sp.end,
          kind
        };
      };
    };
    var tagSpans = function(sp) {
      return function(base) {
        return function(interior) {
          return function(headKind) {
            var v2 = tokenizeInterior(cfg.lexOptions)(base)(interior);
            if (v2 instanceof Left) {
              return [whole(sp)(headKind)];
            }
            ;
            if (v2 instanceof Right) {
              return tile(sp.start)(sp.end)(headKind)(mapMaybe(notable)(v2.value0));
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Highlight (line 92, column 40 - line 94, column 78): " + [v2.constructor.name]);
          };
        };
      };
    };
    var spanOf = function(v2) {
      if (v2 instanceof RContent) {
        return [];
      }
      ;
      if (v2 instanceof ROutput) {
        return tagSpans(v2.value0)(v2.value1)(v2.value2)("raw");
      }
      ;
      if (v2 instanceof RAmp) {
        return tagSpans(v2.value0)(v2.value1)(v2.value2)("raw");
      }
      ;
      if (v2 instanceof ROpen) {
        return tagSpans(v2.value0)(v2.value2)(v2.value3)(sigilKind(v2.value1));
      }
      ;
      if (v2 instanceof RClose) {
        return tagSpans(v2.value0)(v2.value1)(v2.value2)("block-close");
      }
      ;
      if (v2 instanceof RSep) {
        if (isPartialHead(v2.value2)) {
          return [whole(v2.value0)("partial")];
        }
        ;
        if (elem4(headWord(v2.value2))(cfg.clauseSeps)) {
          return tagSpans(v2.value0)(v2.value1)(v2.value2)("keyword");
        }
        ;
        if (otherwise) {
          return tagSpans(v2.value0)(v2.value1)(v2.value2)("expr");
        }
        ;
      }
      ;
      if (v2 instanceof RRaw) {
        return [whole(v2.value0)("raw-block")];
      }
      ;
      if (v2 instanceof RComment) {
        return [whole(v2.value0)("comment")];
      }
      ;
      if (v2 instanceof RLongComment) {
        return [whole(v2.value0)("comment")];
      }
      ;
      if (v2 instanceof RSetDelim) {
        return [whole(v2.value0)("set-delimiter")];
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Highlight (line 68, column 12 - line 83, column 49): " + [v2.constructor.name]);
    };
    var v = tokenizeTemplate(cfg.lexConfig)(src);
    if (v instanceof Left) {
      return [];
    }
    ;
    if (v instanceof Right) {
      return concatMap(spanOf)(v.value0);
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Highlight (line 63, column 26 - line 65, column 44): " + [v.constructor.name]);
  };
};

// output/FlatBars.Json/index.js
var $runtime_lazy3 = function(name2, moduleName, init) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init();
    state2 = 2;
    return val;
  };
};
var map6 = /* @__PURE__ */ map(functorArray);
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
    return id(map6(toJson)(v.value0));
  }
  ;
  if (v instanceof VObject) {
    return id(fromFoldable5(map6(function(v1) {
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
    return new VArray(map6($lazy_fromJson(25))(arr2));
  })(function(obj2) {
    return new VObject(fromFoldable1(map6(function(v) {
      return new Tuple(v.value0, $lazy_fromJson(28)(v.value1));
    })(toUnfoldable1(obj2))));
  });
});
var fromJson = /* @__PURE__ */ $lazy_fromJson(19);

// output/FlatBars.Expr/index.js
var map7 = /* @__PURE__ */ map(functorMaybe);
var bind3 = /* @__PURE__ */ bind(bindEither);
var parseExpr = function(toks) {
  var tk = function(i) {
    return map7(function(v2) {
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
var bind4 = /* @__PURE__ */ bind(bindEither);
var eq32 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqChar));
var map8 = /* @__PURE__ */ map(functorEither);
var append1 = /* @__PURE__ */ append(semigroupArray);
var fromFoldable6 = /* @__PURE__ */ fromFoldable(foldableList);
var eq4 = /* @__PURE__ */ eq(eqSigil);
var StopEOF = /* @__PURE__ */ function() {
  function StopEOF2() {
  }
  ;
  StopEOF2.value = new StopEOF2();
  return StopEOF2;
}();
var StopClose = /* @__PURE__ */ function() {
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
}();
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
var outputExpr = function(lx) {
  return function(pe) {
    return function(span2) {
      return function(base) {
        return function(s) {
          if (trim(s) === "") {
            return new Left(new EmptyOutput(span2.start));
          }
          ;
          if (otherwise) {
            return bind4(tokenizeInterior(lx)(base)(s))(pe);
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Parser (line 251, column 1 - line 251, column 90): " + [lx.constructor.name, pe.constructor.name, span2.constructor.name, base.constructor.name, s.constructor.name]);
        };
      };
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
      return eq32(at(k))(new Just("@")) && maybe(false)(isLetter)(at(k + 1 | 0));
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
        throw new Error("Failed pattern match at FlatBars.Parser (line 203, column 3 - line 206, column 35): " + [k.constructor.name]);
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
        var $47 = maybe(false)(isKeyChar)(at(k));
        if ($47) {
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
        var $48 = maybe(false)(isSpace3)(at(k));
        if ($48) {
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
          throw new Error("Failed pattern match at FlatBars.Parser (line 208, column 3 - line 208, column 50): " + [j.constructor.name, acc.constructor.name]);
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
var headed = function(lx) {
  return function(pe) {
    return function(span2) {
      return function(base) {
        return function(s) {
          if (trim(s) === "") {
            return new Left(new HeadNotIdent(span2.start));
          }
          ;
          if (otherwise) {
            var v = bind4(map8(partialHead)(tokenizeInterior(lx)(base)(s)))(pe);
            if (v instanceof Left) {
              return new Left(v.value0);
            }
            ;
            if (v instanceof Right && v.value0 instanceof App2) {
              return new Right({
                name: v.value0.value0,
                args: v.value0.value1
              });
            }
            ;
            if (v instanceof Right) {
              return new Left(new HeadNotIdent(span2.start));
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Parser (line 267, column 17 - line 270, column 48): " + [v.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Parser (line 258, column 1 - line 264, column 62): " + [lx.constructor.name, pe.constructor.name, span2.constructor.name, base.constructor.name, s.constructor.name]);
        };
      };
    };
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
    throw new Error("Failed pattern match at FlatBars.Parser (line 150, column 33 - line 158, column 8): " + [v.constructor.name]);
  };
};
var defaultParseOptions = {
  trimStandalone: true,
  parseExpr,
  parseHead: parseExpr,
  extras: true,
  inheritance: false,
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
              $copy_acc = append1(acc)(dirs);
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
            throw new Error("Failed pattern match at FlatBars.Parser (line 181, column 14 - line 183, column 42): " + [v1.constructor.name]);
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
          throw new Error("Failed pattern match at FlatBars.Parser (line 174, column 25 - line 185, column 35): " + [v.constructor.name]);
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
var blockCloseName = function(sigil) {
  return function(name2) {
    return function(args) {
      if (sigil instanceof Section) {
        if (name2 === ">") {
          var v = head(args);
          if (v instanceof Just && v.value0 instanceof App2) {
            return v.value0.value0;
          }
          ;
          return name2;
        }
        ;
        if (otherwise) {
          var v = stripPrefix("*")(name2);
          if (v instanceof Just) {
            return v.value0;
          }
          ;
          if (v instanceof Nothing) {
            return name2;
          }
          ;
          throw new Error("Failed pattern match at FlatBars.Parser (line 306, column 20 - line 308, column 24): " + [v.constructor.name]);
        }
        ;
      }
      ;
      return name2;
    };
  };
};
var parseSeq = function(pe) {
  return function(ph) {
    return function(extras) {
      return function(inheritance) {
        return function(lx) {
          return function(toks) {
            var done = function(acc) {
              return function(stop) {
                return {
                  nodes: fromFoldable6(reverse2(acc)),
                  stop
                };
              };
            };
            var go = function($copy_acc) {
              return function($copy_i) {
                var $tco_var_acc = $copy_acc;
                var $tco_done = false;
                var $tco_result;
                function $tco_loop(acc, i) {
                  var v = index(toks)(i);
                  if (v instanceof Nothing) {
                    $tco_done = true;
                    return new Right(done(acc)(StopEOF.value));
                  }
                  ;
                  if (v instanceof Just) {
                    if (v.value0 instanceof RContent) {
                      $tco_var_acc = new Cons(new Content(v.value0.value0), acc);
                      $copy_i = i + 1 | 0;
                      return;
                    }
                    ;
                    if (v.value0 instanceof RComment) {
                      $tco_var_acc = acc;
                      $copy_i = i + 1 | 0;
                      return;
                    }
                    ;
                    if (v.value0 instanceof RLongComment) {
                      $tco_var_acc = acc;
                      $copy_i = i + 1 | 0;
                      return;
                    }
                    ;
                    if (v.value0 instanceof RSetDelim) {
                      $tco_var_acc = acc;
                      $copy_i = i + 1 | 0;
                      return;
                    }
                    ;
                    if (v.value0 instanceof ROutput) {
                      var v1 = outputExpr(lx)(pe)(v.value0.value0)(v.value0.value1)(v.value0.value2);
                      if (v1 instanceof Left) {
                        $tco_done = true;
                        return new Left(v1.value0);
                      }
                      ;
                      if (v1 instanceof Right) {
                        $tco_var_acc = new Cons(new Output(v.value0.value0, v1.value0), acc);
                        $copy_i = i + 1 | 0;
                        return;
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Parser (line 355, column 30 - line 357, column 52): " + [v1.constructor.name]);
                    }
                    ;
                    if (v.value0 instanceof RAmp) {
                      if (!extras) {
                        $tco_done = true;
                        return new Left(new DisallowedShape("{{& }} (unescaped output)", v.value0.value0.start));
                      }
                      ;
                      if (otherwise) {
                        var v1 = outputExpr(lx)(pe)(v.value0.value0)(v.value0.value1)(v.value0.value2);
                        if (v1 instanceof Left) {
                          $tco_done = true;
                          return new Left(v1.value0);
                        }
                        ;
                        if (v1 instanceof Right) {
                          $tco_var_acc = new Cons(new Output(v.value0.value0, v1.value0), acc);
                          $copy_i = i + 1 | 0;
                          return;
                        }
                        ;
                        throw new Error("Failed pattern match at FlatBars.Parser (line 361, column 24 - line 363, column 56): " + [v1.constructor.name]);
                      }
                      ;
                    }
                    ;
                    if (v.value0 instanceof RRaw) {
                      if (!extras) {
                        $tco_done = true;
                        return new Left(new DisallowedShape("{{{{ }}}} (raw block)", v.value0.value0.start));
                      }
                      ;
                      if (otherwise) {
                        var v1 = headed(lx)(pe)(v.value0.value0)(v.value0.value1)(v.value0.value2);
                        if (v1 instanceof Left) {
                          $tco_done = true;
                          return new Left(v1.value0);
                        }
                        ;
                        if (v1 instanceof Right) {
                          $tco_var_acc = new Cons(new RawBlock(v.value0.value0, v1.value0.name, v1.value0.args, v.value0.value3), acc);
                          $copy_i = i + 1 | 0;
                          return;
                        }
                        ;
                        throw new Error("Failed pattern match at FlatBars.Parser (line 366, column 24 - line 368, column 75): " + [v1.constructor.name]);
                      }
                      ;
                    }
                    ;
                    if (v.value0 instanceof RSep) {
                      var v1 = headed(lx)(pe)(v.value0.value0)(v.value0.value1)(v.value0.value2);
                      if (v1 instanceof Left) {
                        $tco_done = true;
                        return new Left(v1.value0);
                      }
                      ;
                      if (v1 instanceof Right) {
                        $tco_var_acc = new Cons(new Sep(v.value0.value0, v1.value0.name, v1.value0.args), acc);
                        $copy_i = i + 1 | 0;
                        return;
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Parser (line 369, column 27 - line 371, column 61): " + [v1.constructor.name]);
                    }
                    ;
                    if (v.value0 instanceof RClose) {
                      var v1 = headed(lx)(pe)({
                        start: v.value0.value1,
                        end: v.value0.value1
                      })(v.value0.value1)(v.value0.value2);
                      if (v1 instanceof Left) {
                        $tco_done = true;
                        return new Left(v1.value0);
                      }
                      ;
                      if (v1 instanceof Right) {
                        $tco_done = true;
                        return new Right(done(acc)(new StopClose(v1.value0.name, i + 1 | 0)));
                      }
                      ;
                      throw new Error("Failed pattern match at FlatBars.Parser (line 372, column 26 - line 374, column 63): " + [v1.constructor.name]);
                    }
                    ;
                    if (v.value0 instanceof ROpen) {
                      if (eq4(v.value0.value1)(Inverse.value) && !extras) {
                        $tco_done = true;
                        return new Left(new DisallowedShape("{{^ }} (inverse block)", v.value0.value0.start));
                      }
                      ;
                      if (eq4(v.value0.value1)(Parent.value) && !inheritance) {
                        $tco_done = true;
                        return new Left(new DisallowedShape("{{< }} (parent block)", v.value0.value0.start));
                      }
                      ;
                      if (eq4(v.value0.value1)(BlockDef.value) && !inheritance) {
                        $tco_done = true;
                        return new Left(new DisallowedShape("{{$ }} (override block)", v.value0.value0.start));
                      }
                      ;
                      if (otherwise) {
                        $tco_done = true;
                        return buildBlock(acc)(v.value0.value0)(v.value0.value1)(v.value0.value2)(v.value0.value3)(i + 1 | 0);
                      }
                      ;
                    }
                    ;
                    throw new Error("Failed pattern match at FlatBars.Parser (line 350, column 15 - line 386, column 64): " + [v.value0.constructor.name]);
                  }
                  ;
                  throw new Error("Failed pattern match at FlatBars.Parser (line 348, column 14 - line 386, column 64): " + [v.constructor.name]);
                }
                ;
                while (!$tco_done) {
                  $tco_result = $tco_loop($tco_var_acc, $copy_i);
                }
                ;
                return $tco_result;
              };
            };
            var buildBlock = function(acc) {
              return function(span2) {
                return function(sigil) {
                  return function(base) {
                    return function(s) {
                      return function(i) {
                        var v = headed(lx)(ph)(span2)(base)(s);
                        if (v instanceof Left) {
                          return new Left(v.value0);
                        }
                        ;
                        if (v instanceof Right) {
                          var expected = blockCloseName(sigil)(v.value0.name)(v.value0.args);
                          var v1 = parseSeq(pe)(ph)(extras)(inheritance)(lx)(toks)(i);
                          if (v1 instanceof Left) {
                            return new Left(v1.value0);
                          }
                          ;
                          if (v1 instanceof Right) {
                            if (v1.value0.stop instanceof StopEOF) {
                              return new Left(new MismatchedBlock(expected, "<eof>", span2.start));
                            }
                            ;
                            if (v1.value0.stop instanceof StopClose) {
                              if (v1.value0.stop.value0 === expected) {
                                return go(new Cons(new Block(span2, sigil, v.value0.name, v.value0.args, v1.value0.nodes), acc))(v1.value0.stop.value1);
                              }
                              ;
                              if (otherwise) {
                                return new Left(new MismatchedBlock(expected, v1.value0.stop.value0, span2.start));
                              }
                              ;
                            }
                            ;
                            throw new Error("Failed pattern match at FlatBars.Parser (line 401, column 26 - line 406, column 79): " + [v1.value0.stop.constructor.name]);
                          }
                          ;
                          throw new Error("Failed pattern match at FlatBars.Parser (line 399, column 9 - line 406, column 79): " + [v1.constructor.name]);
                        }
                        ;
                        throw new Error("Failed pattern match at FlatBars.Parser (line 389, column 40 - line 406, column 79): " + [v.constructor.name]);
                      };
                    };
                  };
                };
              };
            };
            return go(Nil.value);
          };
        };
      };
    };
  };
};
var buildFromTokens = function(opts) {
  return function(toks) {
    return bind4(parseSeq(opts.parseExpr)(opts.parseHead)(opts.extras)(opts.inheritance)(opts.lexOptions)(filter(function($149) {
      return !isComment($149);
    })(toks))(0))(function(res) {
      if (res.stop instanceof StopEOF) {
        return new Right(res.nodes);
      }
      ;
      if (res.stop instanceof StopClose) {
        return new Left(new MismatchedBlock("<none>", res.stop.value0, 0));
      }
      ;
      throw new Error("Failed pattern match at FlatBars.Parser (line 136, column 3 - line 138, column 63): " + [res.stop.constructor.name]);
    });
  };
};
var parseWith = function(opts) {
  return function(src) {
    return bind4(tokenizeTemplate(opts.lexConfig)(src))(function(toks) {
      return bind4(collectDirectives(toks))(function(directives) {
        return bind4(effectiveTrim(opts)(directives))(function(standalone) {
          var toks$prime = function() {
            if (standalone) {
              return trimStandalone(opts.standaloneSeps)(toks);
            }
            ;
            return toks;
          }();
          return bind4(parseSeq(opts.parseExpr)(opts.parseHead)(opts.extras)(opts.inheritance)(opts.lexOptions)(filter(function($150) {
            return !isComment($150);
          })(toks$prime))(0))(function(res) {
            if (res.stop instanceof StopEOF) {
              return new Right({
                directives,
                nodes: res.nodes
              });
            }
            ;
            if (res.stop instanceof StopClose) {
              return new Left(new MismatchedBlock("<none>", res.stop.value0, 0));
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Parser (line 119, column 3 - line 121, column 63): " + [res.stop.constructor.name]);
          });
        });
      });
    });
  };
};
var parse = /* @__PURE__ */ parseWith(defaultParseOptions);

// output/FullBars.Surface/index.js
var foldl3 = /* @__PURE__ */ foldl(foldableArray);
var union2 = /* @__PURE__ */ union(ordString);
var insert2 = /* @__PURE__ */ insert(ordString);
var notEq1 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqString));
var map9 = /* @__PURE__ */ map(functorArray);
var elem5 = /* @__PURE__ */ elem2(eqString);
var append12 = /* @__PURE__ */ append(semigroupArray);
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
      throw new Error("Failed pattern match at FullBars.Surface (line 416, column 24 - line 418, column 32): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FullBars.Surface (line 297, column 18 - line 299, column 34): " + [v.constructor.name]);
};
var segmentsOf = function(s) {
  var flush = function(st) {
    var $77 = st.cur === "";
    if ($77) {
      return st;
    }
    ;
    return {
      inB: st.inB,
      segs: snoc(st.segs)(st.cur),
      cur: ""
    };
  };
  var step = function(st) {
    return function(c) {
      if (st.inB) {
        var $80 = c === "]";
        if ($80) {
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
      throw new Error("Failed pattern match at FullBars.Surface (line 442, column 3 - line 446, column 53): " + [st.constructor.name, c.constructor.name]);
    };
  };
  var $$final = foldl3(step)({
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
  throw new Error("Failed pattern match at FullBars.Surface (line 451, column 14 - line 453, column 31): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at FullBars.Surface (line 422, column 1 - line 422, column 23): " + [n.constructor.name]);
};
var noLoopVars = function(v) {
  return Nothing.value;
};
var hoistInline = function(nodes) {
  var inlineName = function(args) {
    var v = head(args);
    if (v instanceof Just && (v.value0 instanceof Lit && v.value0.value0 instanceof VString)) {
      return new Just(v.value0.value0.value0);
    }
    ;
    return Nothing.value;
  };
  var step = function(acc) {
    return function(v) {
      var v1 = function(v2) {
        if (v instanceof Block) {
          var inner2 = hoistInline(v.value4);
          return {
            partials: union2(acc.partials)(inner2.partials),
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
        var $99 = inlineName(v.value3);
        if ($99 instanceof Just) {
          var inner = hoistInline(v.value4);
          return {
            template: acc.template,
            partials: insert2($99.value0)(inner.template)(union2(acc.partials)(inner.partials))
          };
        }
        ;
        return v1(true);
      }
      ;
      return v1(true);
    };
  };
  return foldl2(step)({
    partials: empty3,
    template: []
  })(nodes);
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
var expandElseIf = /* @__PURE__ */ function() {
  var toElif = function(v) {
    var v1 = function(v2) {
      return v;
    };
    if (v instanceof Sep && v.value1 === "else") {
      var $121 = uncons(v.value2);
      if ($121 instanceof Just && ($121.value0.head instanceof App2 && ($121.value0.head.value0 === "if" && $121.value0.head.value1.length === 0))) {
        var $122 = !$$null($121.value0.tail);
        if ($122) {
          return new Sep(v.value0, "elif", $121.value0.tail);
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
}();
var dictExpr = function(pairs) {
  return new App2("dict", concatMap(function(p) {
    return [new Lit(new VString(p.key)), p.val];
  })(pairs));
};
var dataExpr = function(raw) {
  var v = stripParents(raw)(0);
  var prefix = function() {
    var $132 = v.depth === 0;
    if ($132) {
      return "";
    }
    ;
    return "parent-";
  }();
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
  throw new Error("Failed pattern match at FullBars.Surface (line 361, column 5 - line 365, column 31): " + [v1.constructor.name]);
};
var pathExpr = function(lv) {
  return function(scope) {
    return function(raw) {
      if (raw === "this" || raw === ".") {
        return new App2("this", []);
      }
      ;
      if (otherwise) {
        var v = stripPrefix("@")(raw);
        if (v instanceof Just) {
          return dataExpr(v.value0);
        }
        ;
        if (v instanceof Nothing) {
          var v1 = stripParents(raw)(0);
          var segs = segmentsOf(v1.rest);
          var v2 = uncons(segs);
          if (v2 instanceof Just && (v1.depth === 0 && elem5(v2.value0.head)(scope))) {
            var $146 = $$null(v2.value0.tail);
            if ($146) {
              return new App2(v2.value0.head, []);
            }
            ;
            return new App2("lookup", cons(new App2(v2.value0.head, []))(map9(segKey)(v2.value0.tail)));
          }
          ;
          var v3 = function(v4) {
            var base = parents(v1.depth);
            var $150 = $$null(segs);
            if ($150) {
              return base;
            }
            ;
            return new App2("lookup", cons(base)(map9(segKey)(segs)));
          };
          if (v2 instanceof Just) {
            var $152 = v1.depth === 0 && $$null(v2.value0.tail);
            if ($152) {
              var $153 = lv(raw);
              if ($153 instanceof Just) {
                return new App2($153.value0, []);
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
        throw new Error("Failed pattern match at FullBars.Surface (line 322, column 17 - line 347, column 70): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at FullBars.Surface (line 319, column 1 - line 319, column 47): " + [lv.constructor.name, scope.constructor.name, raw.constructor.name]);
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
        throw new Error("Failed pattern match at FullBars.Surface (line 305, column 17 - line 307, column 37): " + [v.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at FullBars.Surface (line 302, column 1 - line 302, column 49): " + [lv.constructor.name, scope.constructor.name, t.constructor.name]);
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
      throw new Error("Failed pattern match at FullBars.Surface (line 311, column 1 - line 311, column 48): " + [lv.constructor.name, scope.constructor.name, name2.constructor.name]);
    };
  };
};
var asHashKey = function(lv) {
  return function(scope) {
    return function(v) {
      if (v instanceof App2 && (v.value1.length === 0 && contains("=")(v.value0))) {
        var v1 = splitFirstEq(v.value0);
        return new Just(function() {
          var $170 = v1.rest === "";
          if ($170) {
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
        }());
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
      var $175 = $$null(h.pairs);
      if ($175) {
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
      throw new Error("Failed pattern match at FullBars.Surface (line 237, column 20 - line 241, column 56): " + [v.constructor.name]);
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
              throw new Error("Failed pattern match at FullBars.Surface (line 270, column 43 - line 273, column 92): " + [v2.constructor.name]);
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
            throw new Error("Failed pattern match at FullBars.Surface (line 269, column 28 - line 276, column 79): " + [v1.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FullBars.Surface (line 267, column 17 - line 276, column 79): " + [v.constructor.name]);
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
var partialCall = function(lv) {
  return function(scope) {
    return function(nameExpr) {
      return function(valueArgs) {
        var h = collectHash(lv)(scope)(valueArgs);
        var ctx2 = maybe(new App2("this", []))(rewrite(lv)(scope))(head(h.positional));
        var $195 = $$null(h.pairs);
        if ($195) {
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
      throw new Error("Failed pattern match at FullBars.Surface (line 223, column 28 - line 225, column 34): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FullBars.Surface (line 217, column 29 - line 219, column 49): " + [v.constructor.name]);
    };
  };
};
var partialExpr = function(lv) {
  return function(scope) {
    return function(rest) {
      return function(args) {
        var v = function() {
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
            throw new Error("Failed pattern match at FullBars.Surface (line 194, column 13 - line 196, column 65): " + [v1.constructor.name]);
          }
          ;
          return {
            nameExpr: new Lit(new VString(rest)),
            valueArgs: args
          };
        }();
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
        throw new Error("Failed pattern match at FullBars.Surface (line 179, column 1 - line 179, column 64): " + [lv.constructor.name, scope.constructor.name, name2.constructor.name, args.constructor.name]);
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
            throw new Error("Failed pattern match at FullBars.Surface (line 108, column 24 - line 112, column 87): " + [v1.constructor.name]);
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
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === ">")) {
          return new Block(v.value0, Section.value, "partial", partialArgs(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "*inline")) {
          return new Block(v.value0, Section.value, "inline", inlineArgs(lv)(scope)(v.value3), go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && v.value1 instanceof Inverse) {
          return new Block(v.value0, Section.value, "unless", [rewriteHead(lv)(scope)(v.value2)(v.value3)], go(scope)(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block && v.value1 instanceof Section) {
          var v1 = extractBlockParams(v.value3);
          return new Block(v.value0, Section.value, v.value2, append12(rewriteArgs(lv)(scope)(v1.mainArgs))(map9(function($275) {
            return Lit.create(VString.create($275));
          })(v1.params)), go(append12(scope)(v1.params))(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof Block) {
          var v1 = extractBlockParams(v.value3);
          return new Block(v.value0, v.value1, v.value2, append12(rewriteArgs(lv)(scope)(v1.mainArgs))(map9(function($276) {
            return Lit.create(VString.create($276));
          })(v1.params)), go(append12(scope)(v1.params))(expandElseIf(v.value4)));
        }
        ;
        if (v instanceof RawBlock) {
          return new RawBlock(v.value0, v.value1, v.value2, v.value3);
        }
        ;
        throw new Error("Failed pattern match at FullBars.Surface (line 100, column 12 - line 154, column 61): " + [v.constructor.name]);
      };
      return map9(node);
    };
    return go([]);
  };
};
var desugar = /* @__PURE__ */ desugarWith(noLoopVars);

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
var boundedEnumChar = /* @__PURE__ */ function() {
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
}();

// output/Data.Char/index.js
var toCharCode2 = /* @__PURE__ */ fromEnum(boundedEnumChar);

// output/Data.Set/index.js
var coerce3 = /* @__PURE__ */ coerce();
var member2 = function(dictOrd) {
  return coerce3(member(dictOrd));
};
var insert3 = function(dictOrd) {
  var insert1 = insert(dictOrd);
  return function(a) {
    return function(v) {
      return insert1(a)(unit)(v);
    };
  };
};
var empty4 = empty3;
var fromFoldable7 = function(dictFoldable) {
  var foldl22 = foldl(dictFoldable);
  return function(dictOrd) {
    var insert1 = insert3(dictOrd);
    return foldl22(function(m) {
      return function(a) {
        return insert1(a)(m);
      };
    })(empty4);
  };
};
var $$delete2 = function(dictOrd) {
  return coerce3($$delete(dictOrd));
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

// output/Data.String.CodePoints/index.js
var fromEnum2 = /* @__PURE__ */ fromEnum(boundedEnumChar);
var map10 = /* @__PURE__ */ map(functorMaybe);
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
  return map10(function(v) {
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

// output/Kernel.Value/index.js
var show3 = /* @__PURE__ */ show(showNumber);
var map11 = /* @__PURE__ */ map(functorEither);
var traverse2 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var foldMap2 = /* @__PURE__ */ foldMap(foldableArray)(monoidString);
var map1 = /* @__PURE__ */ map(functorArray);
var power2 = /* @__PURE__ */ power(monoidString);
var toUnfoldable6 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var FFalse = /* @__PURE__ */ function() {
  function FFalse2() {
  }
  ;
  FFalse2.value = new FFalse2();
  return FFalse2;
}();
var FNull = /* @__PURE__ */ function() {
  function FNull2() {
  }
  ;
  FNull2.value = new FNull2();
  return FNull2;
}();
var FEmptyStr = /* @__PURE__ */ function() {
  function FEmptyStr2() {
  }
  ;
  FEmptyStr2.value = new FEmptyStr2();
  return FEmptyStr2;
}();
var FZero = /* @__PURE__ */ function() {
  function FZero2() {
  }
  ;
  FZero2.value = new FZero2();
  return FZero2;
}();
var FEmptyArr = /* @__PURE__ */ function() {
  function FEmptyArr2() {
  }
  ;
  FEmptyArr2.value = new FEmptyArr2();
  return FEmptyArr2;
}();
var FEmptyObj = /* @__PURE__ */ function() {
  function FEmptyObj2() {
  }
  ;
  FEmptyObj2.value = new FEmptyObj2();
  return FEmptyObj2;
}();
var eqFalsyShape = {
  eq: function(x) {
    return function(y) {
      if (x instanceof FFalse && y instanceof FFalse) {
        return true;
      }
      ;
      if (x instanceof FNull && y instanceof FNull) {
        return true;
      }
      ;
      if (x instanceof FEmptyStr && y instanceof FEmptyStr) {
        return true;
      }
      ;
      if (x instanceof FZero && y instanceof FZero) {
        return true;
      }
      ;
      if (x instanceof FEmptyArr && y instanceof FEmptyArr) {
        return true;
      }
      ;
      if (x instanceof FEmptyObj && y instanceof FEmptyObj) {
        return true;
      }
      ;
      return false;
    };
  }
};
var ordFalsyShape = {
  compare: function(x) {
    return function(y) {
      if (x instanceof FFalse && y instanceof FFalse) {
        return EQ.value;
      }
      ;
      if (x instanceof FFalse) {
        return LT.value;
      }
      ;
      if (y instanceof FFalse) {
        return GT.value;
      }
      ;
      if (x instanceof FNull && y instanceof FNull) {
        return EQ.value;
      }
      ;
      if (x instanceof FNull) {
        return LT.value;
      }
      ;
      if (y instanceof FNull) {
        return GT.value;
      }
      ;
      if (x instanceof FEmptyStr && y instanceof FEmptyStr) {
        return EQ.value;
      }
      ;
      if (x instanceof FEmptyStr) {
        return LT.value;
      }
      ;
      if (y instanceof FEmptyStr) {
        return GT.value;
      }
      ;
      if (x instanceof FZero && y instanceof FZero) {
        return EQ.value;
      }
      ;
      if (x instanceof FZero) {
        return LT.value;
      }
      ;
      if (y instanceof FZero) {
        return GT.value;
      }
      ;
      if (x instanceof FEmptyArr && y instanceof FEmptyArr) {
        return EQ.value;
      }
      ;
      if (x instanceof FEmptyArr) {
        return LT.value;
      }
      ;
      if (y instanceof FEmptyArr) {
        return GT.value;
      }
      ;
      if (x instanceof FEmptyObj && y instanceof FEmptyObj) {
        return EQ.value;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 0, column 0 - line 0, column 0): " + [x.constructor.name, y.constructor.name]);
    };
  },
  Eq0: function() {
    return eqFalsyShape;
  }
};
var fromFoldable8 = /* @__PURE__ */ fromFoldable7(foldableArray)(ordFalsyShape);
var member3 = /* @__PURE__ */ member2(ordFalsyShape);
var shapeOf = function(off) {
  return function(v) {
    if (v === "false") {
      return new Right(FFalse.value);
    }
    ;
    if (v === "null") {
      return new Right(FNull.value);
    }
    ;
    if (v === '""') {
      return new Right(FEmptyStr.value);
    }
    ;
    if (v === "0") {
      return new Right(FZero.value);
    }
    ;
    if (v === "[]") {
      return new Right(FEmptyArr.value);
    }
    ;
    if (v === "{}") {
      return new Right(FEmptyObj.value);
    }
    ;
    return note(new DirectiveError("unknown @truthiness value '" + (v + "'"), off))(Nothing.value);
  };
};
var presence = /* @__PURE__ */ function() {
  return fromFoldable8([FFalse.value, FNull.value, FEmptyArr.value, FEmptyObj.value]);
}();
var numberToString = function(n) {
  var s = show3(n);
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
    return new Right(function() {
      if (v.value0) {
        return "true";
      }
      ;
      return "false";
    }());
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
    return map11(joinWith(","))(traverse2(stringify2)(v.value0));
  }
  ;
  if (v instanceof VObject) {
    return new Left(new $$TypeError("cannot stringify an object"));
  }
  ;
  throw new Error("Failed pattern match at Kernel.Value (line 197, column 13 - line 204, column 61): " + [v.constructor.name]);
};
var mustache = /* @__PURE__ */ function() {
  return fromFoldable8([FFalse.value, FNull.value, FEmptyArr.value]);
}();
var minimal = /* @__PURE__ */ function() {
  return fromFoldable8([FFalse.value, FNull.value]);
}();
var jsonQuote = function(s) {
  var pad2 = function(h) {
    var $52 = length3(h) === 1;
    if ($52) {
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
    var $54 = code < 32;
    if ($54) {
      return "\\u00" + pad2(toStringAs(hexadecimal)(code));
    }
    ;
    return singleton6(c);
  };
  return '"' + (foldMap2(esc)(toCharArray(s)) + '"');
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
            return open + ("\n" + (joinWith(",\n")(map1(function(it) {
              return power2(mIndent.value0)(depth + 1 | 0) + it;
            })(items)) + ("\n" + (power2(mIndent.value0)(depth) + close))));
          }
          ;
          throw new Error("Failed pattern match at Kernel.Value (line 253, column 32 - line 261, column 17): " + [mIndent.constructor.name]);
        };
      };
    };
    var colon = function() {
      if (mIndent instanceof Just) {
        return ": ";
      }
      ;
      if (mIndent instanceof Nothing) {
        return ":";
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 248, column 11 - line 250, column 19): " + [mIndent.constructor.name]);
    }();
    var member1 = function(v) {
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
        return container("[")("]")(map1(renderJson(mIndent)(depth + 1 | 0))(v.value0));
      }
      ;
      if (v instanceof VObject) {
        return container("{")("}")(map1(member1)(toUnfoldable6(v.value0)));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 236, column 28 - line 245, column 70): " + [v.constructor.name]);
    };
  };
};
var jsonStringify = /* @__PURE__ */ function() {
  return renderJson(Nothing.value)(0);
}();
var jsonStringifyPretty = /* @__PURE__ */ function() {
  return renderJson(new Just("  "))(0);
}();
var isFalsy = function($copy_fs) {
  return function($copy_v) {
    var $tco_var_fs = $copy_fs;
    var $tco_done = false;
    var $tco_result;
    function $tco_loop(fs, v) {
      if (v instanceof VBool) {
        $tco_done = true;
        return !v.value0 && member3(FFalse.value)(fs);
      }
      ;
      if (v instanceof VNull) {
        $tco_done = true;
        return member3(FNull.value)(fs);
      }
      ;
      if (v instanceof VString && v.value0 === "") {
        $tco_done = true;
        return member3(FEmptyStr.value)(fs);
      }
      ;
      if (v instanceof VString) {
        $tco_done = true;
        return false;
      }
      ;
      if (v instanceof VNumber) {
        $tco_done = true;
        return v.value0 === 0 && member3(FZero.value)(fs);
      }
      ;
      if (v instanceof VArray) {
        $tco_done = true;
        return $$null(v.value0) && member3(FEmptyArr.value)(fs);
      }
      ;
      if (v instanceof VObject) {
        $tco_done = true;
        return isEmpty(v.value0) && member3(FEmptyObj.value)(fs);
      }
      ;
      if (v instanceof VSafe) {
        $tco_var_fs = fs;
        $copy_v = new VString(v.value0);
        return;
      }
      ;
      throw new Error("Failed pattern match at Kernel.Value (line 80, column 14 - line 88, column 36): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_fs, $copy_v);
    }
    ;
    return $tco_result;
  };
};
var truthy = function(fs) {
  var $84 = isFalsy(fs);
  return function($85) {
    return !$84($85);
  };
};
var handlebars = /* @__PURE__ */ function() {
  return fromFoldable8([FFalse.value, FNull.value, FEmptyStr.value, FZero.value, FEmptyArr.value]);
}();
var escapeHtml = /* @__PURE__ */ function() {
  var $86 = replaceAll("'")("&#x27;");
  var $87 = replaceAll('"')("&quot;");
  var $88 = replaceAll(">")("&gt;");
  var $89 = replaceAll("<")("&lt;");
  var $90 = replaceAll("&")("&amp;");
  return function($91) {
    return $86($87($88($89($90($91)))));
  };
}();
var always = empty4;
var aliasSet = function(v) {
  if (v === "empty") {
    return new Just(handlebars);
  }
  ;
  if (v === "handlebars") {
    return new Just(handlebars);
  }
  ;
  if (v === "minimal") {
    return new Just(minimal);
  }
  ;
  if (v === "ruby") {
    return new Just(minimal);
  }
  ;
  if (v === "nil") {
    return new Just(minimal);
  }
  ;
  if (v === "lua") {
    return new Just(minimal);
  }
  ;
  if (v === "presence") {
    return new Just(presence);
  }
  ;
  if (v === "always") {
    return new Just(always);
  }
  ;
  if (v === "mustache") {
    return new Just(mustache);
  }
  ;
  return Nothing.value;
};
var parseTruthiness = function(off) {
  return function(value) {
    var tokens = function(v2) {
      return filter(function(v12) {
        return v12 !== "";
      })(split(" ")(replaceAll("	")(" ")(replaceAll("\n")(" ")(replaceAll("\r")(" ")(v2)))));
    };
    var v = aliasSet(value);
    if (v instanceof Just) {
      return new Right(v.value0);
    }
    ;
    if (v instanceof Nothing) {
      var v1 = tokens(value);
      if (v1.length === 0) {
        return new Left(new DirectiveError("empty @truthiness value; use the 'always' alias for nothing-falsy", off));
      }
      ;
      return map11(fromFoldable8)(traverse2(shapeOf(off))(v1));
    }
    ;
    throw new Error("Failed pattern match at Kernel.Value (line 166, column 29 - line 171, column 57): " + [v.constructor.name]);
  };
};
var resolveTruthinessWith = function(def) {
  return function(directives) {
    var v = filter(function(d) {
      return d.key === "truthiness";
    })(directives);
    if (v.length === 0) {
      return new Right(def);
    }
    ;
    if (v.length === 1) {
      return parseTruthiness(v[0].span.start)(v[0].value);
    }
    ;
    return new Left(new DirectiveError("duplicate @truthiness directive (at most one per file)", maybe(0)(function(d) {
      return d.span.start;
    })(index(v)(1))));
  };
};
var resolveTruthiness = /* @__PURE__ */ resolveTruthinessWith(handlebars);

// output/Kernel.Env/index.js
var union3 = /* @__PURE__ */ union(ordString);
var insert4 = /* @__PURE__ */ insert(ordString);
var foldl4 = /* @__PURE__ */ foldl(foldableArray);
var lookup2 = /* @__PURE__ */ lookup(ordString);
var withFalsy = function(fs) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      partialFalsy: v.partialFalsy,
      depth: v.depth,
      falsy: fs
    };
  };
};
var registerPartialsFalsy = function(fs) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      partials: v.partials,
      falsy: v.falsy,
      depth: v.depth,
      partialFalsy: union3(fs)(v.partialFalsy)
    };
  };
};
var registerPartials = function(ps) {
  return function(v) {
    return {
      context: v.context,
      helpers: v.helpers,
      falsy: v.falsy,
      partialFalsy: v.partialFalsy,
      depth: v.depth,
      partials: union3(ps)(v.partials)
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
          falsy: v.falsy,
          partialFalsy: v.partialFalsy,
          depth: v.depth,
          helpers: new Cons(singleton5(name2)(h), Nil.value)
        };
      }
      ;
      if (v.helpers instanceof Cons) {
        return {
          context: v.context,
          partials: v.partials,
          falsy: v.falsy,
          partialFalsy: v.partialFalsy,
          depth: v.depth,
          helpers: new Cons(insert4(name2)(h)(v.helpers.value0), v.helpers.value1)
        };
      }
      ;
      throw new Error("Failed pattern match at Kernel.Env (line 118, column 37 - line 120, column 61): " + [v.helpers.constructor.name]);
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
var refFalsy = function(v) {
  return v.falsy;
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
        falsy: v.falsy,
        partialFalsy: v.partialFalsy,
        depth: v.depth,
        helpers: new Cons(frame, v.helpers),
        context: ctx2
      };
    };
  };
};
var lookupPartialFalsy = function(name2) {
  return function(v) {
    return lookup2(name2)(v.partialFalsy);
  };
};
var lookupPartial = function(name2) {
  return function(v) {
    return lookup2(name2)(v.partials);
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
          var v2 = lookup2(name2)(v1.value0);
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
          throw new Error("Failed pattern match at Kernel.Env (line 130, column 19 - line 132, column 23): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at Kernel.Env (line 129, column 3 - line 129, column 19): " + [v1.constructor.name]);
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
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var liftEither1 = liftEither(dictMonadThrow);
  return function(onMissing) {
    return function(initial) {
      return {
        initial,
        resolve: function(env) {
          return function(name2) {
            var v = lookupOperation(name2)(env);
            if (v instanceof Just) {
              return pure5(v.value0);
            }
            ;
            if (v instanceof Nothing) {
              return onMissing(env)(name2);
            }
            ;
            throw new Error("Failed pattern match at Kernel.Env (line 182, column 27 - line 184, column 36): " + [v.constructor.name]);
          };
        },
        stringify: function(v) {
          return liftEither1(stringify2(v));
        }
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
    falsy: v.falsy,
    partialFalsy: v.partialFalsy,
    depth: v.depth + 1 | 0
  };
};
var emptyEnv = function(ctx2) {
  return {
    context: ctx2,
    helpers: new Cons(empty3, Nil.value),
    partials: empty3,
    falsy: handlebars,
    partialFalsy: empty3,
    depth: 0
  };
};
var constOperation = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      return function(v2) {
        return pure5(v);
      };
    };
  };
};

// output/Kernel.Walk/index.js
var map12 = /* @__PURE__ */ map(functorMaybe);
var map13 = /* @__PURE__ */ map(functorArray);
var show4 = /* @__PURE__ */ show(showInt);
var Exactly = /* @__PURE__ */ function() {
  function Exactly2(value0) {
    this.value0 = value0;
  }
  ;
  Exactly2.create = function(value0) {
    return new Exactly2(value0);
  };
  return Exactly2;
}();
var AtLeast = /* @__PURE__ */ function() {
  function AtLeast2(value0) {
    this.value0 = value0;
  }
  ;
  AtLeast2.create = function(value0) {
    return new AtLeast2(value0);
  };
  return AtLeast2;
}();
var Between = /* @__PURE__ */ function() {
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
}();
var AnyArity = /* @__PURE__ */ function() {
  function AnyArity2() {
  }
  ;
  AnyArity2.value = new AnyArity2();
  return AnyArity2;
}();
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
  throw new Error("Failed pattern match at Kernel.Walk (line 167, column 22 - line 169, column 86): " + [v.constructor.name]);
};
var splitClause = function(name2) {
  return function(nodes) {
    var s = splitClauses(nodes);
    return {
      before: s.before,
      clause: map12(function(v) {
        return v.body;
      })(find2(function(c) {
        return c.name === name2;
      })(s.clauses))
    };
  };
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
    throw new Error("Failed pattern match at Kernel.Walk (line 145, column 10 - line 150, column 93): " + [v.constructor.name]);
  };
  var go = function(nodes) {
    return alg.concat(map13(node)(nodes));
  };
  return go;
};
var arityText2 = function(v) {
  if (v instanceof Exactly) {
    return "exactly " + show4(v.value0);
  }
  ;
  if (v instanceof AtLeast) {
    return "at least " + show4(v.value0);
  }
  ;
  if (v instanceof Between) {
    return show4(v.value0) + ("\u2013" + show4(v.value1));
  }
  ;
  if (v instanceof AnyArity) {
    return "any number of";
  }
  ;
  throw new Error("Failed pattern match at Kernel.Walk (line 242, column 13 - line 246, column 30): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at Kernel.Walk (line 235, column 15 - line 239, column 19): " + [a.constructor.name]);
  };
};

// output/Kernel.Lower/index.js
var RText = /* @__PURE__ */ function() {
  function RText2(value0) {
    this.value0 = value0;
  }
  ;
  RText2.create = function(value0) {
    return new RText2(value0);
  };
  return RText2;
}();
var ROut = /* @__PURE__ */ function() {
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
}();
var RIf = /* @__PURE__ */ function() {
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
}();
var RUnless = /* @__PURE__ */ function() {
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
}();
var REach = /* @__PURE__ */ function() {
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
}();
var RWith = /* @__PURE__ */ function() {
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
}();
var RCall = /* @__PURE__ */ function() {
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
}();
var RSep2 = /* @__PURE__ */ function() {
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
}();
var RRaw2 = /* @__PURE__ */ function() {
  function RRaw3(value0) {
    this.value0 = value0;
  }
  ;
  RRaw3.create = function(value0) {
    return new RRaw3(value0);
  };
  return RRaw3;
}();
var lower = /* @__PURE__ */ function() {
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
          throw new Error("Failed pattern match at Kernel.Lower (line 107, column 22 - line 111, column 32): " + [v2.constructor.name]);
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
    concat: join(bindArray)
  });
}();

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
var Precision = /* @__PURE__ */ function() {
  function Precision2(value0) {
    this.value0 = value0;
  }
  ;
  Precision2.create = function(value0) {
    return new Precision2(value0);
  };
  return Precision2;
}();
var Fixed = /* @__PURE__ */ function() {
  function Fixed2(value0) {
    this.value0 = value0;
  }
  ;
  Fixed2.create = function(value0) {
    return new Fixed2(value0);
  };
  return Fixed2;
}();
var Exponential = /* @__PURE__ */ function() {
  function Exponential2(value0) {
    this.value0 = value0;
  }
  ;
  Exponential2.create = function(value0) {
    return new Exponential2(value0);
  };
  return Exponential2;
}();
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
var fixed = /* @__PURE__ */ function() {
  var $9 = clamp2(0)(20);
  return function($10) {
    return Fixed.create($9($10));
  };
}();

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
var eq5 = /* @__PURE__ */ eq(eqValue);
var map14 = /* @__PURE__ */ map(functorArray);
var union4 = /* @__PURE__ */ union(ordString);
var map15 = /* @__PURE__ */ map(functorMaybe);
var lookup3 = /* @__PURE__ */ lookup(ordString);
var $$delete3 = /* @__PURE__ */ $$delete2(ordFalsyShape);
var notEq3 = /* @__PURE__ */ notEq(eqValue);
var sub2 = /* @__PURE__ */ sub(ringNumber);
var mul2 = /* @__PURE__ */ mul(semiringNumber);
var div3 = /* @__PURE__ */ div(euclideanRingNumber);
var traverse3 = /* @__PURE__ */ traverse(traversableArray);
var fromFoldable9 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var append13 = /* @__PURE__ */ append(semigroupArray);
var identity6 = /* @__PURE__ */ identity(categoryFn);
var elem6 = /* @__PURE__ */ elem2(eqValue);
var alter2 = /* @__PURE__ */ alter(ordString);
var map23 = /* @__PURE__ */ map(functorMap);
var insert5 = /* @__PURE__ */ insert(ordString);
var compare2 = /* @__PURE__ */ compare(ordNumber);
var compare12 = /* @__PURE__ */ compare(ordString);
var max3 = /* @__PURE__ */ max(ordInt);
var min3 = /* @__PURE__ */ min(ordInt);
var discard2 = /* @__PURE__ */ discard(discardUnit);
var toUnfoldable7 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var eq33 = /* @__PURE__ */ eq(eqOrdering);
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
    return function(mk) {
      var s = mk(name2);
      return {
        name: name2,
        block: false,
        arity: s.arity,
        run: s.run,
        alias: Nothing.value,
        synonymOf: Nothing.value
      };
    };
  };
};
var uniqueH = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(v) {
    if (v instanceof VArray) {
      return pure5(new VArray(nubByEq(eq5)(v.value0)));
    }
    ;
    return pure5(new VArray([]));
  };
};
var thisH = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(ctl) {
    return function(v) {
      return pure5(refContext(ctl.env));
    };
  };
};
var stringifyM = function(dictMonadThrow) {
  var $711 = liftEither(dictMonadThrow);
  return function($712) {
    return $711(stringify2($712));
  };
};
var toFloatH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  return function(v) {
    return bind9(stringifyM1(v))(function(s) {
      return pure5(maybe(VNull.value)(VNumber.create)(fromString(s)));
    });
  };
};
var toIntH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  return function(v) {
    return bind9(stringifyM1(v))(function(s) {
      return pure5(maybe(VNull.value)(function($713) {
        return VNumber.create(trunc($713));
      })(fromString(s)));
    });
  };
};
var strUnary = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(f) {
    return function(v) {
      return map32(function($714) {
        return VString.create(f($714));
      })(stringifyM1(v));
    };
  };
};
var startsWithH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
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
          throw new Error("Failed pattern match at Kernel.Prelude (line 564, column 24 - line 566, column 21): " + [v.constructor.name]);
        };
      };
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure5(new VBool(isJustPrefix(x)(s)));
        });
      });
    };
  };
};
var splitH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(sepv) {
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(sepv))(function(sep) {
          return pure5(new VArray(map14(VString.create)(split(sep)(s))));
        });
      });
    };
  };
};
var safe2 = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    return map32(VSafe.create)(stringifyM1(v));
  };
};
var reverseCodeUnits = function($715) {
  return fromCharArray(reverse(toCharArray($715)));
};
var reverseH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure5 = pure(Monad0.Applicative0());
  var map32 = map(Monad0.Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    if (v instanceof VArray) {
      return pure5(new VArray(reverse(v.value0)));
    }
    ;
    if (v instanceof VString) {
      return pure5(new VString(reverseCodeUnits(v.value0)));
    }
    ;
    return map32(function($716) {
      return VString.create(reverseCodeUnits($716));
    })(stringifyM1(v));
  };
};
var replaceH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      if (args.length === 3) {
        return bind9(stringifyM1(args[0]))(function(s) {
          return bind9(stringifyM1(args[1]))(function(find3) {
            return bind9(stringifyM1(args[2]))(function(rep) {
              return pure5(new VString(replaceAll(find3)(rep)(s)));
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
  var pure5 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure5(new VString(x + s));
        });
      });
    };
  };
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
              return new VObject(union4(opts.value0)(ctx2.value0));
            }
            ;
            return new VObject(opts.value0);
          }
          ;
          return ctx2;
        };
      };
      var blockFrame = function() {
        var $523 = $$null(ctl.children);
        if ($523) {
          return empty3;
        }
        ;
        return singleton5("partial-block")(function(v) {
          return function(v1) {
            return map32(VSafe.create)(ctl.render(ctl.env)(ctl.children));
          };
        });
      }();
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
              var scoped = function() {
                var v1 = lookupPartialFalsy(name2)(ctl.env);
                if (v1 instanceof Just) {
                  return withFalsy(v1.value0)(entered);
                }
                ;
                if (v1 instanceof Nothing) {
                  return entered;
                }
                ;
                throw new Error("Failed pattern match at Kernel.Prelude (line 1122, column 22 - line 1124, column 33): " + [v1.constructor.name]);
              }();
              return map32(VSafe.create)(ctl.render(scoped)(v.value0));
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
          throw new Error("Failed pattern match at Kernel.Prelude (line 1114, column 28 - line 1129, column 63): " + [v.constructor.name]);
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
      return maybe(false)(truthy(handlebars))(lookup3(key)(v.value0));
    }
    ;
    return false;
  };
};
var truthyWith = function(fs) {
  return function(opts) {
    return function(v) {
      return truthy(function() {
        var $541 = optFlag("includeZero")(opts);
        if ($541) {
          return $$delete3(FZero.value)(fs);
        }
        ;
        return fs;
      }())(v);
    };
  };
};
var pickClause = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure5 = pure(Monad0.Applicative0());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var map32 = map(Bind1.Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(clauses) {
      var v = uncons(clauses);
      if (v instanceof Nothing) {
        return pure5(new VSafe(""));
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
                return bind9(function() {
                  if (mOpts instanceof Nothing) {
                    return pure5(truthy(refFalsy(ctl.env))(cond));
                  }
                  ;
                  if (mOpts instanceof Just) {
                    return map32(function(opts) {
                      return truthyWith(refFalsy(ctl.env))(opts)(cond);
                    })(ctl["eval"](ctl.env)(mOpts.value0));
                  }
                  ;
                  throw new Error("Failed pattern match at Kernel.Prelude (line 885, column 16 - line 888, column 18): " + [mOpts.constructor.name]);
                }())(function(hit) {
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 871, column 26 - line 890, column 82): " + [v.constructor.name]);
    };
  };
};
var notH = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        return pure5(new VBool(!truthy(refFalsy(ctl.env))(args[0])));
      }
      ;
      return throwError3(new ArityError("not: expected exactly 1 argument"));
    };
  };
};
var ne$prime = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(a) {
    return function(b) {
      return pure5(new VBool(notEq3(a)(b)));
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
var jsonText = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(name2) {
    return function(args) {
      if (args.length === 1) {
        return pure5(jsonStringify(args[0]));
      }
      ;
      if (args.length === 2) {
        return pure5(function() {
          var $558 = optFlag("pretty")(args[1]);
          if ($558) {
            return jsonStringifyPretty;
          }
          ;
          return jsonStringify;
        }()(args[0]));
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
  var traverse12 = traverse3(Applicative0);
  var pure5 = pure(Applicative0);
  var map32 = map(Bind1.Apply0().Functor0());
  return function(av) {
    return function(sepv) {
      return bind9(stringifyM1(sepv))(function(sep) {
        if (av instanceof VArray) {
          return bind9(traverse12(stringifyM1)(av.value0))(function(parts) {
            return pure5(new VString(joinWith(sep)(parts)));
          });
        }
        ;
        return map32(VString.create)(stringifyM1(av));
      });
    };
  };
};
var iterate2 = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Applicative0 = Monad0.Applicative0();
  var constOperation2 = constOperation(Applicative0);
  var map32 = map(Monad0.Bind1().Apply0().Functor0());
  var traverse12 = traverse3(Applicative0);
  return function(ctl) {
    return function(names) {
      return function(items) {
        var n = length(items);
        var main = mainBody(ctl);
        var binds = function(val) {
          return function(idx) {
            return zipWith(function(nm) {
              return function(v) {
                return new Tuple(nm, constOperation2(v));
              };
            })(names)([val, idx]);
          };
        };
        var renderItem = function(i) {
          return function(v) {
            var frame = fromFoldable9(append13([new Tuple("this", constOperation2(v.val)), new Tuple("index", constOperation2(new VNumber(toNumber(i)))), new Tuple("key", constOperation2(v.key)), new Tuple("first", constOperation2(new VBool(i === 0))), new Tuple("last", constOperation2(new VBool(i === (n - 1 | 0)))), new Tuple("parent", constOperation2(refContext(ctl.env))), new Tuple("index0", constOperation2(new VNumber(toNumber(i)))), new Tuple("index1", constOperation2(new VNumber(toNumber(i + 1 | 0)))), new Tuple("rindex0", constOperation2(new VNumber(toNumber((n - 1 | 0) - i | 0)))), new Tuple("rindex1", constOperation2(new VNumber(toNumber(n - i | 0)))), new Tuple("length", constOperation2(new VNumber(toNumber(n))))])(append13(parentData(ctl))(binds(v.val)(v.idx))));
            return ctl.render(pushFrame(frame)(v.val)(ctl.env))(main);
          };
        };
        return map32(function() {
          var $717 = joinWith("");
          return function($718) {
            return VSafe.create($717($718));
          };
        }())(traverse12(identity6)(mapWithIndex2(renderItem)(items)));
      };
    };
  };
};
var inlineH = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(v) {
    return function(v1) {
      return pure5(new VSafe(""));
    };
  };
};
var indexValue = function(v) {
  return function(v1) {
    if (v instanceof VObject && v1 instanceof VString) {
      return fromMaybe(VNull.value)(lookup3(v1.value0)(v.value0));
    }
    ;
    if (v instanceof VObject && v1 instanceof VNumber) {
      return fromMaybe(VNull.value)(lookup3(show6(round2(v1.value0)))(v.value0));
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 806, column 38 - line 808, column 19): " + [v2.constructor.name]);
    }
    ;
    return VNull.value;
  };
};
var lookupH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(v) {
    return function(args) {
      var step = function(v12) {
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
        return pure5(foldl2(step)(v1.value0.head)(v1.value0.tail));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 794, column 18 - line 796, column 59): " + [v1.constructor.name]);
    };
  };
};
var includesH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure5 = pure(Monad0.Applicative0());
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(sv) {
    return function(xv) {
      if (sv instanceof VArray) {
        return pure5(new VBool(elem6(xv)(sv.value0)));
      }
      ;
      if (sv instanceof VString) {
        return bind9(stringifyM1(xv))(function(sub22) {
          return pure5(new VBool(contains(sub22)(sv.value0)));
        });
      }
      ;
      return pure5(new VBool(false));
    };
  };
};
var gen = function(name2) {
  return function(block) {
    return function(arity) {
      return function(run3) {
        return {
          name: name2,
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
  var pure5 = pure(Monad0.Applicative0());
  var foldM2 = foldM(Monad0);
  return function(av) {
    return function(keyv) {
      var insertGroup = function(key) {
        return function(acc) {
          return function(el) {
            return bind9(stringifyM1(extractPath(key)(el)))(function(k) {
              return pure5(alter2(function(mv) {
                return new Just(cons(el)(fromMaybe([])(mv)));
              })(k)(acc));
            });
          };
        };
      };
      return bind9(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return bind9(foldM2(insertGroup(key))(empty3)(av.value0))(function(grouped) {
            return pure5(new VObject(map23(function($719) {
              return VArray.create(reverse($719));
            })(grouped)));
          });
        }
        ;
        return pure5(new VObject(empty3));
      });
    };
  };
};
var pluckH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  return function(av) {
    return function(keyv) {
      return bind9(stringifyM1(keyv))(function(key) {
        if (av instanceof VArray) {
          return pure5(new VArray(map14(extractPath(key))(av.value0)));
        }
        ;
        return pure5(new VArray([]));
      });
    };
  };
};
var escJsonH = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var jsonText1 = jsonText(dictMonadThrow);
  return function(v) {
    return function(args) {
      return map32(function($720) {
        return VSafe.create(escapeHtml($720));
      })(jsonText1("escapeJson")(args));
    };
  };
};
var escHtml = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var pure5 = pure(Monad0.Applicative0());
  var map32 = map(Monad0.Bind1().Apply0().Functor0());
  var stringifyM1 = stringifyM(dictMonadThrow);
  return function(v) {
    if (v instanceof VSafe) {
      return pure5(new VSafe(v.value0));
    }
    ;
    return map32(function($721) {
      return VSafe.create(escapeHtml($721));
    })(stringifyM1(v));
  };
};
var eq$prime = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(a) {
    return function(b) {
      return pure5(new VBool(eq5(a)(b)));
    };
  };
};
var endsWithH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
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
          throw new Error("Failed pattern match at Kernel.Prelude (line 574, column 26 - line 576, column 21): " + [v.constructor.name]);
        };
      };
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure5(new VBool(isJustSuffix(x)(s)));
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
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
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
              return pure5(new VObject(acc));
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
              throw new Error("Failed pattern match at Kernel.Prelude (line 1079, column 39 - line 1081, column 73): " + [v2.constructor.name]);
            }
            ;
            if (v1 instanceof Just) {
              $tco_done = true;
              return throwError3(new $$TypeError("dict: keys must be strings"));
            }
            ;
            throw new Error("Failed pattern match at Kernel.Prelude (line 1077, column 18 - line 1082, column 66): " + [v1.constructor.name]);
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
var countH = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(v) {
    if (v instanceof VArray) {
      return pure5(new VNumber(toNumber(length(v.value0))));
    }
    ;
    if (v instanceof VObject) {
      return pure5(new VNumber(toNumber(size2(v.value0))));
    }
    ;
    return pure5(new VNumber(0));
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
  var pure5 = pure(Monad0.Applicative0());
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
          return pure5(new VArray(sortBy(function(a) {
            return function(b) {
              return keyOrdering(key)(a)(b);
            };
          })(av.value0)));
        }
        ;
        return pure5(new VArray([]));
      });
    };
  };
};
var coalesceH = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  return function(v) {
    return function(args) {
      var notNull = function(v1) {
        if (v1 instanceof VNull) {
          return false;
        }
        ;
        return true;
      };
      return pure5(fromMaybe(VNull.value)(find2(notNull)(args)));
    };
  };
};
var cmp = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(ok) {
    return function(a) {
      return function(b) {
        return pure5(new VBool(maybe(false)(ok)(compareValues(a)(b))));
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
    throw new Error("Failed pattern match at Kernel.Prelude (line 538, column 1 - line 538, column 32): " + [len.constructor.name, i.constructor.name]);
  };
};
var checkIfClauses = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(clauses) {
    var v = uncons(clauses);
    if (v instanceof Nothing) {
      return pure5(unit);
    }
    ;
    if (v instanceof Just) {
      if (v.value0.head.name === "else") {
        if ($$null(v.value0.tail)) {
          return pure5(unit);
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
    throw new Error("Failed pattern match at Kernel.Prelude (line 897, column 26 - line 907, column 82): " + [v.constructor.name]);
  };
};
var ifH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var pure5 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  var discard1 = discard2(Bind1);
  var checkIfClauses1 = checkIfClauses(dictMonadThrow);
  var renderSafe1 = renderSafe(dictMonadThrow);
  var pickClause1 = pickClause(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      return bind9(function() {
        if (args.length === 1) {
          return pure5(truthy(refFalsy(ctl.env))(args[0]));
        }
        ;
        if (args.length === 2) {
          return pure5(truthyWith(refFalsy(ctl.env))(args[1])(args[0]));
        }
        ;
        return throwError3(new ArityError(wrong1or2("if")(args)));
      }())(function(cond) {
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
  throw new Error("Failed pattern match at Kernel.Prelude (line 464, column 19 - line 466, column 68): " + [v.constructor.name]);
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
        return branchOn1(!truthy(refFalsy(ctl.env))(args[0]))(ctl);
      }
      ;
      if (args.length === 2) {
        return branchOn1(!truthyWith(refFalsy(ctl.env))(args[1])(args[0]))(ctl);
      }
      ;
      return throwError3(new ArityError(wrong1or2("unless")(args)));
    };
  };
};
var boolH = function(dictApplicative) {
  var pure5 = pure(dictApplicative);
  return function(quant) {
    return function(ctl) {
      return function(args) {
        return pure5(new VBool(quant(truthy(refFalsy(ctl.env)))(args)));
      };
    };
  };
};
var bodyStart = function(s) {
  var body = trim(s);
  var $647 = body === "";
  if ($647) {
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
  throw new Error("Failed pattern match at Kernel.Prelude (line 480, column 16 - line 482, column 68): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at Kernel.Prelude (line 475, column 18 - line 477, column 31): " + [v.constructor.name]);
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
          var $656 = $$null(v.value0.head.value0);
          if ($656) {
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
          var pairs = toUnfoldable7(v.value0.head.value0);
          var $658 = $$null(pairs);
          if ($658) {
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
      throw new Error("Failed pattern match at Kernel.Prelude (line 944, column 18 - line 965, column 84): " + [v.constructor.name]);
    };
  };
};
var withH = function(dictMonadThrow) {
  var constOperation2 = constOperation(dictMonadThrow.Monad0().Applicative0());
  var renderSafe1 = renderSafe(dictMonadThrow);
  var renderElse1 = renderElse(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      var v = uncons(args);
      if (v instanceof Just) {
        var $667 = truthy(refFalsy(ctl.env))(v.value0.head);
        if ($667) {
          var binds = zipWith(function(nm) {
            return function(val) {
              return new Tuple(nm, constOperation2(val));
            };
          })(bindingNames(v.value0.tail))([v.value0.head]);
          var frame = fromFoldable9(append13([new Tuple("parent", constOperation2(refContext(ctl.env)))])(append13(parentData(ctl))(binds)));
          return renderSafe1(ctl)(pushFrame(frame)(v.value0.head)(ctl.env))(mainBody(ctl));
        }
        ;
        return renderElse1(ctl);
      }
      ;
      if (v instanceof Nothing) {
        return throwError3(new ArityError("with: expected at least 1 argument(s), got 0"));
      }
      ;
      throw new Error("Failed pattern match at Kernel.Prelude (line 1035, column 18 - line 1048, column 84): " + [v.constructor.name]);
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
        throw new Error("Failed pattern match at Kernel.Prelude (line 1063, column 1 - line 1063, column 77): " + [name2.constructor.name, ctl.constructor.name, args.constructor.name]);
      };
    };
  };
};
var blockHelperMissing = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var sectionOp1 = sectionOp(dictMonadThrow);
  return function(v) {
    return function(name2) {
      return pure5(sectionOp1(name2));
    };
  };
};
var asNum = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    if (v instanceof VNumber) {
      return pure5(v.value0);
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
      return map32(function($722) {
        return VNumber.create(f($722));
      })(asNum1(v));
    };
  };
};
var asInt = function(dictMonadThrow) {
  var map32 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var asNum1 = asNum(dictMonadThrow);
  return function(v) {
    return map32(function($723) {
      return round2(trunc($723));
    })(asNum1(v));
  };
};
var atH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var asInt1 = asInt(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  return function(av) {
    return function(iv) {
      return bind9(asInt1(iv))(function(i) {
        if (av instanceof VArray) {
          var idx = function() {
            var $679 = i < 0;
            if ($679) {
              return length(av.value0) + i | 0;
            }
            ;
            return i;
          }();
          return pure5(fromMaybe(VNull.value)(index(av.value0)(idx)));
        }
        ;
        return pure5(VNull.value);
      });
    };
  };
};
var sliceH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var asInt1 = asInt(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var slice1 = function(sv) {
        return function(startv) {
          return function(mEndv) {
            return bind9(stringifyM1(sv))(function(s) {
              return bind9(asInt1(startv))(function(start) {
                var len = length2(s);
                return bind9(function() {
                  if (mEndv instanceof Nothing) {
                    return pure5(len);
                  }
                  ;
                  if (mEndv instanceof Just) {
                    return asInt1(mEndv.value0);
                  }
                  ;
                  throw new Error("Failed pattern match at Kernel.Prelude (line 528, column 12 - line 530, column 30): " + [mEndv.constructor.name]);
                }())(function(end) {
                  var lo = clampIndex(len)(start);
                  var hi = clampIndex(len)(end);
                  return pure5(new VString(function() {
                    var $683 = lo >= hi;
                    if ($683) {
                      return "";
                    }
                    ;
                    return take2(hi - lo | 0)(drop2(lo)(s));
                  }()));
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
  var pure5 = pure(Monad0.Applicative0());
  return function(f) {
    return function(av) {
      return function(nv) {
        return bind9(asInt1(nv))(function(n) {
          if (av instanceof VArray) {
            return pure5(new VArray(f(max3(0)(n))(av.value0)));
          }
          ;
          return pure5(new VArray([]));
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
  var pure5 = pure(Monad0.Applicative0());
  return function(nv) {
    return function(dv) {
      return bind9(asNum1(nv))(function(n) {
        return bind9(asInt1(dv))(function(d) {
          return pure5(new VString(toStringWith(fixed(d))(n)));
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
  var pure5 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      var truncate1 = function(sv) {
        return function(nv) {
          return function(suf) {
            return bind9(stringifyM1(sv))(function(s) {
              return bind9(asInt1(nv))(function(n) {
                return pure5(new VString(function() {
                  var $692 = length2(s) > n;
                  if ($692) {
                    return take2(n)(s) + suf;
                  }
                  ;
                  return s;
                }()));
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
  var pure5 = pure(Monad0.Applicative0());
  return function(op) {
    return function(a) {
      return function(b) {
        return bind9(asNum1(a))(function(x) {
          return bind9(asNum1(b))(function(y) {
            return pure5(new VNumber(op(x)(y)));
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
        throw new Error("Failed pattern match at Kernel.Prelude (line 1086, column 40 - line 1088, column 47): " + [v1.constructor.name]);
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
  var pure5 = pure(Applicative0);
  var unary2 = unary(dictMonadThrow);
  var binary2 = binary(dictMonadThrow);
  var ne$prime1 = ne$prime(Applicative0);
  var cmp1 = cmp(Applicative0);
  var boolH1 = boolH(Applicative0);
  var arith1 = arith(dictMonadThrow);
  return [gen("this")(false)(new Exactly(0))(thisH(Applicative0)), gen("lookup")(false)(new AtLeast(1))(lookupH(dictMonadThrow)), valDef1("true")(nullary2(pure5(new VBool(true)))), valDef1("false")(nullary2(pure5(new VBool(false)))), valDef1("null")(nullary2(pure5(VNull.value))), valDef1("escapeHtml")(unary2(escHtml(dictMonadThrow))), valDef1("safe")(unary2(safe2(dictMonadThrow))), gen("json")(false)(new Between(1, 2))(jsonH(dictMonadThrow)), gen("escapeJson")(false)(new Between(1, 2))(escJsonH(dictMonadThrow)), gen("raw")(true)(AnyArity.value)(rawH(dictMonadThrow)), gen("if")(true)(new Between(1, 2))(ifH(dictMonadThrow)), gen("unless")(true)(new Between(1, 2))(unlessH(dictMonadThrow)), gen("each")(true)(new AtLeast(1))(eachH(dictMonadThrow)), gen("with")(true)(new AtLeast(1))(withH(dictMonadThrow)), valDef1("else")(nullary2(pure5(new VSafe("")))), gen("elif")(false)(new Between(1, 2))(function(v) {
    return function(v1) {
      return pure5(new VSafe(""));
    };
  }), gen("dict")(false)(AnyArity.value)(dictH(dictMonadThrow)), gen("apply")(true)(new AtLeast(1))(applyH(dictMonadThrow)), gen("partial")(false)(new Between(2, 3))(partialH(dictMonadThrow)), gen("inline")(true)(new AtLeast(1))(inlineH(Applicative0)), valDef1("eq")(binary2(eq$prime(Applicative0))), valDef1("ne")(binary2(ne$prime1)), valDef1("lt")(binary2(cmp1(function(v) {
    return eq33(v)(LT.value);
  }))), valDef1("gt")(binary2(cmp1(function(v) {
    return eq33(v)(GT.value);
  }))), valDef1("lte")(binary2(cmp1(function(v) {
    return notEq12(v)(GT.value);
  }))), valDef1("gte")(binary2(cmp1(function(v) {
    return notEq12(v)(LT.value);
  }))), withSynonym("ne")(valDef1("isnt")(binary2(ne$prime1))), gen("not")(false)(new Exactly(1))(notH(dictMonadThrow)), gen("and")(false)(AnyArity.value)(boolH1(all2)), gen("or")(false)(AnyArity.value)(boolH1(any2)), valDef1("add")(binary2(arith1(add1))), valDef1("subtract")(binary2(arith1(sub2))), valDef1("multiply")(binary2(arith1(mul2))), valDef1("divide")(binary2(arith1(div3))), valDef1("modulo")(binary2(arith1(jsMod))), withAlias("add")(valDef1("plus")(binary2(arith1(add1)))), withAlias("subtract")(valDef1("minus")(binary2(arith1(sub2)))), withAlias("multiply")(valDef1("times")(binary2(arith1(mul2)))), gen("coalesce")(false)(new AtLeast(1))(coalesceH(dictMonadThrow)), valDef1("log")(atLeast(dictMonadThrow)(1)($$const(pure5(VNull.value))))];
};
var appendH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var stringifyM1 = stringifyM(dictMonadThrow);
  var pure5 = pure(Monad0.Applicative0());
  return function(sv) {
    return function(xv) {
      return bind9(stringifyM1(sv))(function(s) {
        return bind9(stringifyM1(xv))(function(x) {
          return pure5(new VString(s + x));
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
  return [valDef1("lowercase")(unary2(strUnary1(toLower))), valDef1("uppercase")(unary2(strUnary1(toUpper))), valDef1("capitalize")(unary2(strUnary1(capitalizeStr))), valDef1("trim")(unary2(strUnary1(trim))), valDef1("trimStart")(unary2(strUnary1(trimStartStr))), valDef1("trimEnd")(unary2(strUnary1(trimEndStr))), valDef1("split")(binary2(splitH(dictMonadThrow))), gen("replace")(false)(new Exactly(3))(replaceH(dictMonadThrow)), gen("slice")(false)(new Between(2, 3))(sliceH(dictMonadThrow)), valDef1("includes")(binary2(includesH(dictMonadThrow))), valDef1("startsWith")(binary2(startsWithH(dictMonadThrow))), valDef1("endsWith")(binary2(endsWithH(dictMonadThrow))), gen("truncate")(false)(new Between(2, 3))(truncateH(dictMonadThrow)), valDef1("append")(binary2(appendH(dictMonadThrow))), valDef1("prepend")(binary2(prependH(dictMonadThrow))), withAlias("lowercase")(valDef1("downcase")(unary2(strUnary1(toLower)))), withAlias("uppercase")(valDef1("upcase")(unary2(strUnary1(toUpper)))), valDef1("abs")(unary2(numUnary1(abs))), valDef1("floor")(unary2(numUnary1(floor))), valDef1("ceil")(unary2(numUnary1(ceil))), valDef1("round")(unary2(numUnary1(round))), valDef1("toFixed")(binary2(toFixedH(dictMonadThrow))), valDef1("toInt")(unary2(toIntH(dictMonadThrow))), valDef1("toFloat")(unary2(toFloatH(dictMonadThrow))), valDef1("join")(binary2(joinH(dictMonadThrow))), valDef1("count")(unary2(countH1)), withSynonym("count")(valDef1("size")(unary2(countH1))), valDef1("at")(binary2(atH(dictMonadThrow))), valDef1("take")(binary2(takeH(dictMonadThrow))), valDef1("takeRight")(binary2(takeRightH(dictMonadThrow))), valDef1("reverse")(unary2(reverseH(dictMonadThrow))), valDef1("unique")(unary2(uniqueH(Applicative0))), valDef1("sortBy")(binary2(sortByH(dictMonadThrow))), valDef1("pluck")(binary2(pluckH(dictMonadThrow))), valDef1("groupBy")(binary2(groupByH(dictMonadThrow)))];
};
var operationDefs = function(dictMonadThrow) {
  return append13(coreOperationDefs(dictMonadThrow))(primitiveOperationDefs(dictMonadThrow));
};
var prelude = function(dictMonadThrow) {
  return map14(function(d) {
    return new Tuple(d.name, d.run);
  })(operationDefs(dictMonadThrow));
};

// output/Kernel.Engine/index.js
var traverse4 = /* @__PURE__ */ traverse(traversableArray);
var runTemplate = function(dictMonad) {
  var Bind1 = dictMonad.Bind1();
  var map25 = map(Bind1.Apply0().Functor0());
  var Applicative0 = dictMonad.Applicative0();
  var traverse12 = traverse4(Applicative0);
  var pure5 = pure(Applicative0);
  var bind9 = bind(Bind1);
  return function(engine) {
    var renderTemplate = function(env) {
      return function(nodes) {
        return map25(joinWith(""))(traverse12(renderNode(env))(nodes));
      };
    };
    var renderNode = function(env) {
      return function(v) {
        if (v instanceof Content) {
          return pure5(v.value0);
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
        throw new Error("Failed pattern match at Kernel.Engine (line 68, column 20 - line 79, column 81): " + [v.constructor.name]);
      };
    };
    var evalExpr = function(env) {
      return function(span2) {
        return function(v) {
          if (v instanceof Lit) {
            return pure5(v.value0);
          }
          ;
          if (v instanceof App2) {
            return bind9(traverse12(evalExpr(env)(span2))(v.value1))(function(vals) {
              return bind9(engine.resolve(env)(v.value0))(function(h) {
                return h(ctl(env)([])(span2))(vals);
              });
            });
          }
          ;
          throw new Error("Failed pattern match at Kernel.Engine (line 88, column 23 - line 93, column 31): " + [v.constructor.name]);
        };
      };
    };
    var ctl = function(env) {
      return function(body) {
        return function(span2) {
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
            }
          };
        };
      };
    };
    var applyBlock = function(env) {
      return function(span2) {
        return function(name2) {
          return function(args) {
            return function(body) {
              return bind9(traverse12(evalExpr(env)(span2))(args))(function(vals) {
                return bind9(engine.resolve(env)(name2))(function(h) {
                  return bind9(h(ctl(env)(body)(span2))(vals))(engine.stringify);
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

// output/Kernel.Render/index.js
var show7 = /* @__PURE__ */ show(showError);
var preludeEnv = function(dictMonadThrow) {
  var prelude2 = prelude(dictMonadThrow);
  var constOperation2 = constOperation(dictMonadThrow.Monad0().Applicative0());
  return function(dat) {
    return registerAll(prelude2)(register("root")(constOperation2(dat))(emptyEnv(dat)));
  };
};
var runResolvedUsing = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var bind9 = bind(Monad0.Bind1());
  var liftEither2 = liftEither(dictMonadThrow);
  var runTemplate3 = runTemplate(Monad0);
  var preludeEnv1 = preludeEnv(dictMonadThrow);
  return function(toEngine) {
    return function(directives) {
      return function(setup) {
        return function(nodes) {
          return function(dat) {
            return bind9(liftEither2(resolveTruthiness(directives)))(function(fs) {
              return runTemplate3(toEngine(withFalsy(fs)(setup(preludeEnv1(dat)))))(nodes);
            });
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

// output/FullBars/index.js
var runResolvedLenient2 = /* @__PURE__ */ runResolvedLenient(monadThrowEither);
var show8 = /* @__PURE__ */ show(showParseError);
var show1 = /* @__PURE__ */ show(showError);
var traverse5 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable10 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var map16 = /* @__PURE__ */ map(functorArray);
var union5 = /* @__PURE__ */ union(ordString);
var surfaceClauses = ["else", "elif"];
var desugarSurfaceWith = function(lv) {
  return desugarWith(lv)(surfaceClauses);
};
var renderSurfaceDiagWith = function(lv) {
  return function(opts) {
    return function(src) {
      return function(dat) {
        var v = parseWith(opts)(src);
        if (v instanceof Left) {
          return new Left(renderParseErrorAt(src)(v.value0));
        }
        ;
        if (v instanceof Right) {
          var v1 = hoistInline(desugarSurfaceWith(lv)(v.value0.nodes));
          var v2 = runResolvedLenient2(v.value0.directives)(registerPartials(v1.partials))(v1.template)(dat);
          if (v2 instanceof Left) {
            return new Left(formatError(src)(v2.value0));
          }
          ;
          if (v2 instanceof Right) {
            return new Right(v2.value0);
          }
          ;
          throw new Error("Failed pattern match at FullBars (line 157, column 7 - line 159, column 31): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at FullBars (line 151, column 41 - line 159, column 31): " + [v.constructor.name]);
      };
    };
  };
};
var renderSurfaceDiag = /* @__PURE__ */ renderSurfaceDiagWith(noLoopVars)(defaultParseOptions);
var desugarSurface = /* @__PURE__ */ desugar(surfaceClauses);
var renderSurfaceWith = function(partialSrcs) {
  return function(src) {
    return function(dat) {
      var compilePartial = function(v4) {
        var v12 = parse(v4.value1);
        if (v12 instanceof Left) {
          return new Left(show8(v12.value0));
        }
        ;
        if (v12 instanceof Right) {
          var v22 = resolveTruthiness(v12.value0.directives);
          if (v22 instanceof Left) {
            return new Left(show1(v22.value0));
          }
          ;
          if (v22 instanceof Right) {
            return new Right({
              name: v4.value0,
              template: desugarSurface(v12.value0.nodes),
              falsy: v22.value0
            });
          }
          ;
          throw new Error("Failed pattern match at FullBars (line 100, column 36 - line 102, column 75): " + [v22.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at FullBars (line 98, column 35 - line 102, column 75): " + [v12.constructor.name]);
      };
      var v = traverse5(compilePartial)(partialSrcs);
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        var v1 = parse(src);
        if (v1 instanceof Left) {
          return new Left(show8(v1.value0));
        }
        ;
        if (v1 instanceof Right) {
          var v2 = hoistInline(desugarSurface(v1.value0.nodes));
          var externalT = fromFoldable10(map16(function(p) {
            return new Tuple(p.name, p.template);
          })(v.value0));
          var externalF = fromFoldable10(map16(function(p) {
            return new Tuple(p.name, p.falsy);
          })(v.value0));
          var setup = function() {
            var $102 = registerPartialsFalsy(externalF);
            var $103 = registerPartials(union5(v2.partials)(externalT));
            return function($104) {
              return $102($103($104));
            };
          }();
          var v3 = runResolvedLenient2(v1.value0.directives)(setup)(v2.template)(dat);
          if (v3 instanceof Left) {
            return new Left(show1(v3.value0));
          }
          ;
          if (v3 instanceof Right) {
            return new Right(v3.value0);
          }
          ;
          throw new Error("Failed pattern match at FullBars (line 92, column 11 - line 94, column 35): " + [v3.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at FullBars (line 81, column 17 - line 94, column 35): " + [v1.constructor.name]);
      }
      ;
      throw new Error("Failed pattern match at FullBars (line 79, column 3 - line 94, column 35): " + [v.constructor.name]);
    };
  };
};
var renderSurfaceWithHelpers = function(helpers) {
  return function(partialSrcs) {
    return function(src) {
      return function(dat) {
        var compilePartial = function(v4) {
          var v12 = parse(v4.value1);
          if (v12 instanceof Left) {
            return new Left(renderParseErrorAt(v4.value1)(v12.value0));
          }
          ;
          if (v12 instanceof Right) {
            var v22 = resolveTruthiness(v12.value0.directives);
            if (v22 instanceof Left) {
              return new Left(show1(v22.value0));
            }
            ;
            if (v22 instanceof Right) {
              return new Right({
                name: v4.value0,
                template: desugarSurface(v12.value0.nodes),
                falsy: v22.value0
              });
            }
            ;
            throw new Error("Failed pattern match at FullBars (line 138, column 36 - line 140, column 75): " + [v22.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FullBars (line 136, column 35 - line 140, column 75): " + [v12.constructor.name]);
        };
        var v = traverse5(compilePartial)(partialSrcs);
        if (v instanceof Left) {
          return new Left(v.value0);
        }
        ;
        if (v instanceof Right) {
          var v1 = parse(src);
          if (v1 instanceof Left) {
            return new Left(renderParseErrorAt(src)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            var v2 = hoistInline(desugarSurface(v1.value0.nodes));
            var externalT = fromFoldable10(map16(function(p) {
              return new Tuple(p.name, p.template);
            })(v.value0));
            var externalF = fromFoldable10(map16(function(p) {
              return new Tuple(p.name, p.falsy);
            })(v.value0));
            var setup = function() {
              var $105 = registerAll(helpers);
              var $106 = registerPartialsFalsy(externalF);
              var $107 = registerPartials(union5(v2.partials)(externalT));
              return function($108) {
                return $105($106($107($108)));
              };
            }();
            var v3 = runResolvedLenient2(v1.value0.directives)(setup)(v2.template)(dat);
            if (v3 instanceof Left) {
              return new Left(formatError(src)(v3.value0));
            }
            ;
            if (v3 instanceof Right) {
              return new Right(v3.value0);
            }
            ;
            throw new Error("Failed pattern match at FullBars (line 131, column 11 - line 133, column 35): " + [v3.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at FullBars (line 119, column 17 - line 133, column 35): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at FullBars (line 117, column 3 - line 133, column 35): " + [v.constructor.name]);
      };
    };
  };
};

// output/FlatBars.Compile/index.js
var $runtime_lazy4 = function(name2, moduleName, init) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init();
    state2 = 2;
    return val;
  };
};
var foldMap3 = /* @__PURE__ */ foldMap(foldableArray)(monoidString);
var show9 = /* @__PURE__ */ show(showInt);
var map17 = /* @__PURE__ */ map(functorArray);
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
  return '"' + (foldMap3(esc)(toCharArray(s)) + '"');
};
var compile = function(meta) {
  return function(emit) {
    return function(partials) {
      return function(main) {
        var rec = {
          expr: function(ctx2) {
            return function(e) {
              return emit.expr(rec)(ctx2)(e);
            };
          },
          nodes: function(ctx2) {
            return function(ts) {
              return foldMap3(node(ctx2))(ts);
            };
          },
          child: function(ctx2) {
            return {
              scope: "c" + show9(ctx2.depth + 1 | 0),
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
              return emit.block(rec)(ctx2)(v.value2)(v.value3)(v.value4);
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
            throw new Error("Failed pattern match at FlatBars.Compile (line 122, column 14 - line 135, column 97): " + [v.constructor.name]);
          };
        };
        var commaArgs = function(ctx2) {
          var $30 = joinWith(", ");
          var $31 = map17(rec.expr(ctx2));
          return function($32) {
            return $30($31($32));
          };
        };
        var fn = function(withRegistry) {
          return function(t) {
            return "function (data, rt, partials) {\n  partials = partials || {};\n" + (function() {
              if (withRegistry) {
                return $lazy_registry(104);
              }
              ;
              return "";
            }() + ('  let out = "";\n  const c0 = ' + (meta.seed + (";\n" + (rec.nodes({
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
            return "  partials = Object.assign({}, partials, {\n" + (joinWith(",\n")(map17(function(v) {
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
var show10 = /* @__PURE__ */ show(showError);
var show12 = /* @__PURE__ */ show(showNumber);
var member4 = /* @__PURE__ */ member2(ordFalsyShape);
var map18 = /* @__PURE__ */ map(functorArray);
var truthyTest = function(rec) {
  return function(ctx2) {
    return function(args) {
      if (args.length === 1) {
        return "rt.truthy(" + (ctx2.scope + (".falsy, " + (rec.expr(ctx2)(args[0]) + ")")));
      }
      ;
      if (args.length === 2) {
        return "rt.truthyWith(" + (ctx2.scope + (".falsy, " + (rec.expr(ctx2)(args[0]) + (", " + (rec.expr(ctx2)(args[1]) + ")")))));
      }
      ;
      return "false";
    };
  };
};
var runtimeVersion = "0.1.0";
var resolveForCompile = /* @__PURE__ */ function() {
  var toParseError = function(v) {
    if (v instanceof DirectiveError) {
      return new BadDirective(v.value0, v.value1);
    }
    ;
    return new BadDirective(show10(v), 0);
  };
  var $64 = lmap(bifunctorEither)(toParseError);
  return function($65) {
    return $64(resolveTruthiness($65));
  };
}();
var litJs = function(v) {
  if (v instanceof VString) {
    return jsString(v.value0);
  }
  ;
  if (v instanceof VNumber) {
    return show12(v.value0);
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
  throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 107, column 9 - line 114, column 22): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 222, column 22 - line 224, column 20): " + [v.constructor.name]);
    };
  };
};
var falsyLiteral = function(fs) {
  var shapes = [FFalse.value, FNull.value, FEmptyStr.value, FZero.value, FEmptyArr.value, FEmptyObj.value];
  var key = function(v) {
    if (v instanceof FFalse) {
      return "b";
    }
    ;
    if (v instanceof FNull) {
      return "n";
    }
    ;
    if (v instanceof FEmptyStr) {
      return "s";
    }
    ;
    if (v instanceof FZero) {
      return "z";
    }
    ;
    if (v instanceof FEmptyArr) {
      return "a";
    }
    ;
    if (v instanceof FEmptyObj) {
      return "o";
    }
    ;
    throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 67, column 9 - line 73, column 21): " + [v.constructor.name]);
  };
  var flag = function(sh) {
    var $34 = member4(sh)(fs);
    if ($34) {
      return new Just(key(sh) + ": 1");
    }
    ;
    return Nothing.value;
  };
  return "{ " + (joinWith(", ")(mapMaybe(flag)(shapes)) + " }");
};
var metaFor = function(fs) {
  return {
    runtimeVersion,
    preamble: "const $falsy = " + (falsyLiteral(fs) + ";\n"),
    seed: "rt.scope(data, $falsy)"
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
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 154, column 29 - line 165, column 55): " + [v.constructor.name]);
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
      return "{" + (joinWith(", ")(map18(one2)(clauses)) + "}");
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
        return function(body) {
          var subject = head1(rec)(ctx2)(args);
          var s = splitClauses(body);
          var names = "[" + (joinWith(", ")(map18(jsString)(bindingNames2(drop(1)(args)))) + "]");
          var elseClause = function() {
            var v = head(s.clauses);
            if (v instanceof Just) {
              return v.value0.body;
            }
            ;
            if (v instanceof Nothing) {
              return [];
            }
            ;
            throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 179, column 18 - line 181, column 20): " + [v.constructor.name]);
          }();
          var child = rec.child(ctx2);
          return "  out += rt." + (fn + ("(" + (subject + (", " + (ctx2.scope + (", " + (names + (", " + (lambda(rec)(child)(s.before) + (", " + (lambda(rec)(ctx2)(elseClause) + ");\n")))))))))));
        };
      };
    };
  };
};
var args$prime = function(rec) {
  return function(ctx2) {
    var $66 = joinWith(", ");
    var $67 = map18(rec.expr(ctx2));
    return function($68) {
      return $66($67($68));
    };
  };
};
var rtBlock = function(rec) {
  return function(ctx2) {
    return function(name2) {
      return function(args) {
        return function(body) {
          var s = splitClauses(body);
          return "  out += rt.block(" + (jsString(name2) + (", [" + (args$prime(rec)(ctx2)(args) + ("], " + (ctx2.scope + (", " + (lambda(rec)(rec.child(ctx2))(s.before) + (", " + (clausesObj(rec)(ctx2)(s.clauses) + ");\n")))))))));
        };
      };
    };
  };
};
var fbBlock = function(rec) {
  return function(ctx2) {
    return function(name2) {
      return function(args) {
        return function(body) {
          if (name2 === "if") {
            return ifBlock(rec)(ctx2)(truthyTest(rec)(ctx2)(args))(body);
          }
          ;
          if (name2 === "unless") {
            return ifBlock(rec)(ctx2)("!(" + (truthyTest(rec)(ctx2)(args) + ")"))(body);
          }
          ;
          if (name2 === "each") {
            return frameBlock(rec)(ctx2)("each")(args)(body);
          }
          ;
          if (name2 === "with") {
            return frameBlock(rec)(ctx2)("with")(args)(body);
          }
          ;
          if (name2 === "inline") {
            return "";
          }
          ;
          return rtBlock(rec)(ctx2)(name2)(args)(body);
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
        throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 102, column 24 - line 104, column 20): " + [v.constructor.name]);
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
      throw new Error("Failed pattern match at FlatBars.Compile.Emit (line 84, column 18 - line 97, column 92): " + [v.constructor.name]);
    };
  };
};
var fullbarsEmit = {
  expr: fbExpr,
  block: fbBlock
};

// output/FullBars.Compile/index.js
var bind5 = /* @__PURE__ */ bind(bindEither);
var pure2 = /* @__PURE__ */ pure(applicativeEither);
var toUnfoldable8 = /* @__PURE__ */ toUnfoldable3(unfoldableArray);
var compileSurfaceWith = function(lv) {
  return function(opts) {
    return function(src) {
      return bind5(parseWith(opts)(src))(function(v) {
        return bind5(resolveForCompile(v.directives))(function(fs) {
          var h = hoistInline(desugarSurfaceWith(lv)(v.nodes));
          return pure2(compile(metaFor(fs))(fullbarsEmit)(toUnfoldable8(h.partials))(h.template));
        });
      });
    };
  };
};
var compileSurface = /* @__PURE__ */ compileSurfaceWith(noLoopVars)(defaultParseOptions);

// output/MaxBars.Expr/index.js
var map19 = /* @__PURE__ */ map(functorMaybe);
var bind6 = /* @__PURE__ */ bind(bindMaybe);
var bind1 = /* @__PURE__ */ bind(bindEither);
var map110 = /* @__PURE__ */ map(functorEither);
var combinators = function(toks) {
  var tk = function(i) {
    return map19(function(v) {
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
      throw new Error("Failed pattern match at MaxBars.Expr (line 89, column 16 - line 91, column 19): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at MaxBars.Expr (line 87, column 13 - line 91, column 19): " + [v.constructor.name]);
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
  var mulOp = /* @__PURE__ */ function() {
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
  }();
  var len = length(toks);
  var cmpOp = /* @__PURE__ */ function() {
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
  }();
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
            throw new Error("Failed pattern match at MaxBars.Expr (line 101, column 20 - line 103, column 41): " + [v.constructor.name]);
          };
        };
        return bind1(sub3(i))(function(first) {
          return loop(first.val)(first.pos);
        });
      };
    };
  };
  var addOp = /* @__PURE__ */ function() {
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
  }();
  var ladder = function(term) {
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
        throw new Error("Failed pattern match at MaxBars.Expr (line 115, column 33 - line 117, column 54): " + [v.constructor.name]);
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
    return pPipe;
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
      return new Right({
        val: new App2(v.value0.value0, []),
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
        return pArgs(i + 1 | 0)(snoc(acc)(new App2(v.value0.value0, [])));
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
      return bind1(pArgs(i + 1 | 0)([]))(function(r) {
        return new Right({
          val: new App2(v.value0.value0, r.val),
          pos: r.pos
        });
      });
    }
    ;
    return pAtom(i);
  };
  var exprLadder = function(i) {
    return ladder(pApp)(i);
  };
  var headLadder = function(i) {
    return ladder(pAtom)(i);
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
  throw new Error("Failed pattern match at MaxBars.Expr (line 44, column 21 - line 48, column 66): " + [v.constructor.name]);
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
          throw new Error("Failed pattern match at MaxBars.Expr (line 66, column 19 - line 70, column 62): " + [v2.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MaxBars.Expr (line 64, column 3 - line 70, column 62): " + [i.constructor.name, acc.constructor.name]);
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
    return map110(App2.create(v.value0.value0))(collect2(1)([]));
  }
  ;
  return new Left(new LexError("expected a block helper name", comb.posAt(0)));
};

// output/MaxBars/index.js
var maxOptions = /* @__PURE__ */ function() {
  return {
    trimStandalone: defaultParseOptions.trimStandalone,
    inheritance: defaultParseOptions.inheritance,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    parseExpr: parseMaxExpr,
    parseHead: parseMaxHead,
    extras: false,
    lexOptions: {
      infixArith: true
    },
    lexConfig: {
      open: defaultLexConfig.open,
      close: defaultLexConfig.close,
      keepLongComments: defaultLexConfig.keepLongComments,
      mustacheDelims: true
    }
  };
}();
var maxLoopVars = function(v) {
  if (v === "index0") {
    return new Just("index0");
  }
  ;
  if (v === "index1") {
    return new Just("index1");
  }
  ;
  if (v === "rindex0") {
    return new Just("rindex0");
  }
  ;
  if (v === "rindex1") {
    return new Just("rindex1");
  }
  ;
  if (v === "first") {
    return new Just("first");
  }
  ;
  if (v === "last") {
    return new Just("last");
  }
  ;
  if (v === "length") {
    return new Just("length");
  }
  ;
  if (v === "key") {
    return new Just("key");
  }
  ;
  if (v === "index") {
    return new Just("index0");
  }
  ;
  if (v === "rindex") {
    return new Just("rindex0");
  }
  ;
  if (v === "size") {
    return new Just("length");
  }
  ;
  return Nothing.value;
};
var renderMax = /* @__PURE__ */ renderSurfaceDiagWith(maxLoopVars)(maxOptions);
var compileMaxJs = /* @__PURE__ */ compileSurfaceWith(maxLoopVars)(maxOptions);

// output/MinBars.Compile/index.js
var show11 = /* @__PURE__ */ show(showNumber);
var mBlock = function(rec) {
  return function(ctx2) {
    return function(name2) {
      return function(args) {
        return function(body) {
          var child = rec.child(ctx2);
          var arg0 = function() {
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
          }();
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
    return show11(v.value0);
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
var lookup4 = /* @__PURE__ */ lookup(ordString);
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
          var v2 = lookup4(key)(v.value0.value0);
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
          throw new Error("Failed pattern match at MinBars.Context (line 134, column 18 - line 136, column 31): " + [v2.constructor.name]);
        }
        ;
        $tco_var_key = key;
        $copy_v = v.value1;
        return;
      }
      ;
      throw new Error("Failed pattern match at MinBars.Context (line 131, column 12 - line 137, column 23): " + [v.constructor.name]);
    }
    ;
    while (!$tco_done) {
      $tco_result = $tco_loop($tco_var_key, $copy_v);
    }
    ;
    return $tco_result;
  };
};
var seedEnv = function(dat) {
  return function(partials) {
    return function(falsy) {
      return {
        stack: new Cons(dat, Nil.value),
        partials,
        falsy,
        depth: 0,
        blocks: Nil.value
      };
    };
  };
};
var push2 = function(v) {
  return function(v1) {
    return {
      partials: v1.partials,
      falsy: v1.falsy,
      depth: v1.depth,
      blocks: v1.blocks,
      stack: new Cons(v, v1.stack)
    };
  };
};
var minPartials = function(v) {
  return v.partials;
};
var minFalsy = function(v) {
  return v.falsy;
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
      falsy: v.falsy,
      depth: v.depth,
      blocks: new Cons(m, v.blocks)
    };
  };
};
var enterPartial2 = function(v) {
  return {
    stack: v.stack,
    partials: v.partials,
    falsy: v.falsy,
    blocks: v.blocks,
    depth: v.depth + 1 | 0
  };
};
var descend = function(acc) {
  return function(seg) {
    if (acc instanceof VObject) {
      return fromMaybe(VNull.value)(lookup4(seg)(acc.value0));
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
      throw new Error("Failed pattern match at MinBars.Context (line 121, column 17 - line 127, column 40): " + [v1.constructor.name]);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Context (line 118, column 1 - line 118, column 38): " + [name2.constructor.name, v.constructor.name]);
  };
};
var blookup = function(name2) {
  var pick = function(acc) {
    return function(layer) {
      var v = lookup4(name2)(layer);
      if (v instanceof Just) {
        return new Just(v.value0);
      }
      ;
      if (v instanceof Nothing) {
        return acc;
      }
      ;
      throw new Error("Failed pattern match at MinBars.Context (line 94, column 20 - line 96, column 19): " + [v.constructor.name]);
    };
  };
  return foldl5(pick)(Nothing.value);
};

// output/MinBars.Prelude/index.js
var traverse6 = /* @__PURE__ */ traverse(traversableArray);
var eq34 = /* @__PURE__ */ eq(/* @__PURE__ */ eqMaybe(eqString));
var append14 = /* @__PURE__ */ append(semigroupArray);
var lookup5 = /* @__PURE__ */ lookup(ordString);
var stringifyOrEmpty = function(dictMonadThrow) {
  var $190 = liftEither(dictMonadThrow);
  return function($191) {
    return $190(stringify2($191));
  };
};
var sectionH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var map25 = map(Monad0.Bind1().Apply0().Functor0());
  var traverse12 = traverse6(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        var items = function() {
          if (args[0] instanceof VArray) {
            return args[0].value0;
          }
          ;
          var $110 = isFalsy(minFalsy(ctl.env))(args[0]);
          if ($110) {
            return [];
          }
          ;
          return [args[0]];
        }();
        return map25(function() {
          var $192 = joinWith("");
          return function($193) {
            return VSafe.create($192($193));
          };
        }())(traverse12(function(it) {
          return ctl.render(push2(it)(ctl.env))(ctl.children);
        })(items));
      }
      ;
      return throwError3(new HelperError("section: expected exactly one argument"));
    };
  };
};
var mlookupH = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1 && args[0] instanceof VString) {
        return pure5(mresolve(args[0].value0)(ctl.env));
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
  var map25 = map(Monad0.Bind1().Apply0().Functor0());
  var pure5 = pure(Monad0.Applicative0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 1) {
        var $116 = isFalsy(minFalsy(ctl.env))(args[0]);
        if ($116) {
          return map25(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        return pure5(new VSafe(""));
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
                var lead = function() {
                  var $120 = j === 0 && atLineStart || j > 0;
                  if ($120) {
                    return indent;
                  }
                  ;
                  return "";
                }();
                var dropLead = j === lastP && (p === "" && j > 0);
                if (dropLead) {
                  return "";
                }
                ;
                return lead + p;
              };
            };
            var text = joinWith("\n")(mapWithIndex2(piece)(parts));
            var endsNL = lastP >= 0 && eq34(index(parts)(lastP))(new Just(""));
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
              var pre = function() {
                if (atLineStart) {
                  return [new Content(indent)];
                }
                ;
                return [];
              }();
              return append14(pre)(cons(v.value0.head)(go(false)(i + 1 | 0)(v.value0.tail)));
            }
            ;
            throw new Error("Failed pattern match at MinBars.Prelude (line 289, column 32 - line 307, column 66): " + [v.constructor.name]);
          };
        };
      };
      return go(true)(0)(tmpl);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Prelude (line 283, column 1 - line 283, column 49): " + [indent.constructor.name, tmpl.constructor.name]);
  };
};
var partialH2 = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var map25 = map(Monad0.Bind1().Apply0().Functor0());
  var pure5 = pure(Monad0.Applicative0());
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = lookup5(args[0].value0)(minPartials(ctl.env));
        if (v instanceof Just) {
          if (minDepth(ctl.env) >= recursionBudget) {
            return throwError3(new RecursionLimit(recursionBudget));
          }
          ;
          if (otherwise) {
            return map25(VSafe.create)(ctl.render(enterPartial2(ctl.env))(indentTemplate(args[1].value0)(v.value0)));
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure5(new VSafe(""));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 125, column 39 - line 129, column 31): " + [v.constructor.name]);
      }
      ;
      return pure5(new VSafe(""));
    };
  };
};
var escapeH = function(dictMonadThrow) {
  var map25 = map(dictMonadThrow.Monad0().Bind1().Apply0().Functor0());
  var stringifyOrEmpty1 = stringifyOrEmpty(dictMonadThrow);
  var throwError3 = throwError(dictMonadThrow);
  return function(v) {
    return function(args) {
      if (args.length === 1) {
        return map25(function($194) {
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
    throw new Error("Failed pattern match at MinBars.Prelude (line 263, column 1 - line 263, column 45): " + [indent.constructor.name, body.constructor.name]);
  };
};
var dedentTemplate = /* @__PURE__ */ function() {
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
        throw new Error("Failed pattern match at MinBars.Prelude (line 193, column 33 - line 201, column 55): " + [v.constructor.name]);
      };
    };
  };
  return function(tmpl) {
    var amount = function() {
      var v = head(tmpl);
      if (v instanceof Just && v.value0 instanceof Content) {
        return leadingIndent(v.value0.value0);
      }
      ;
      return "";
    }();
    var $158 = amount === "";
    if ($158) {
      return tmpl;
    }
    ;
    return go(true)(amount)(tmpl);
  };
}();
var harvestBlocks = /* @__PURE__ */ function() {
  var blockChild = function(v) {
    if (v instanceof Block && (v.value1 instanceof Section && v.value2 === "block")) {
      var v1 = head(v.value3);
      if (v1 instanceof Just && (v1.value0 instanceof Lit && v1.value0.value0 instanceof VString)) {
        var standalone = length(v.value3) >= 2;
        return new Just(new Tuple(v1.value0.value0.value0, function() {
          if (standalone) {
            return dedentTemplate(v.value4);
          }
          ;
          return v.value4;
        }()));
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
}();
var parentH = function(dictMonadThrow) {
  var throwError3 = throwError(dictMonadThrow);
  var Monad0 = dictMonadThrow.Monad0();
  var map25 = map(Monad0.Bind1().Apply0().Functor0());
  var pure5 = pure(Monad0.Applicative0());
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = lookup5(args[0].value0)(minPartials(ctl.env));
        if (v instanceof Just) {
          if (minDepth(ctl.env) >= recursionBudget) {
            return throwError3(new RecursionLimit(recursionBudget));
          }
          ;
          if (otherwise) {
            var overrides = harvestBlocks(ctl.children);
            var env$prime = layerBlocks(overrides)(enterPartial2(ctl.env));
            return map25(VSafe.create)(ctl.render(env$prime)(indentTemplate(args[1].value0)(v.value0)));
          }
          ;
        }
        ;
        if (v instanceof Nothing) {
          return pure5(new VSafe(""));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 143, column 39 - line 154, column 31): " + [v.constructor.name]);
      }
      ;
      return pure5(new VSafe(""));
    };
  };
};
var blockH = function(dictMonadThrow) {
  var Monad0 = dictMonadThrow.Monad0();
  var Bind1 = Monad0.Bind1();
  var bind9 = bind(Bind1);
  var pure5 = pure(Monad0.Applicative0());
  var map25 = map(Bind1.Apply0().Functor0());
  var throwError3 = throwError(dictMonadThrow);
  return function(ctl) {
    return function(args) {
      if (args.length === 2 && (args[0] instanceof VString && args[1] instanceof VString)) {
        var v = blookup(args[0].value0)(minBlocks(ctl.env));
        if (v instanceof Just) {
          return bind9(function() {
            var $179 = args[1].value0 !== "";
            if ($179) {
              return pure5(args[1].value0);
            }
            ;
            return map25(leadingIndent)(ctl.render(ctl.env)(ctl.children));
          }())(function(expand) {
            return bind9(ctl.render(ctl.env)(v.value0))(function(out) {
              return pure5(new VSafe(indentOverride(expand)(out)));
            });
          });
        }
        ;
        if (v instanceof Nothing) {
          return map25(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 230, column 39 - line 241, column 57): " + [v.constructor.name]);
      }
      ;
      if (args.length === 1 && args[0] instanceof VString) {
        var v = blookup(args[0].value0)(minBlocks(ctl.env));
        if (v instanceof Just) {
          return map25(VSafe.create)(ctl.render(ctl.env)(v.value0));
        }
        ;
        if (v instanceof Nothing) {
          return map25(VSafe.create)(ctl.render(ctl.env)(ctl.children));
        }
        ;
        throw new Error("Failed pattern match at MinBars.Prelude (line 244, column 23 - line 246, column 57): " + [v.constructor.name]);
      }
      ;
      return throwError3(new HelperError("block: expected exactly one string name"));
    };
  };
};
var minEngine = function(dictMonadThrow) {
  var pure5 = pure(dictMonadThrow.Monad0().Applicative0());
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
            return pure5(mlookupH1);
          }
          ;
          if (name2 === "escape") {
            return pure5(escapeH1);
          }
          ;
          if (name2 === "section") {
            return pure5(sectionH1);
          }
          ;
          if (name2 === "inverted") {
            return pure5(invertedH1);
          }
          ;
          if (name2 === "partial") {
            return pure5(partialH1);
          }
          ;
          if (name2 === "parent") {
            return pure5(parentH1);
          }
          ;
          if (name2 === "block") {
            return pure5(blockH1);
          }
          ;
          return throwError3(new HelperError("unknown MinBars helper '" + (name2 + "'")));
        };
      },
      stringify: function(v) {
        return liftEither2(stringify2(v));
      }
    };
  };
};

// output/MinBars.Standalone/index.js
var notEq4 = /* @__PURE__ */ notEq(/* @__PURE__ */ eqMaybe(eqInt));
var nlIndex2 = function(first) {
  return function(s) {
    var f = function() {
      if (first) {
        return findIndex;
      }
      ;
      return findLastIndex;
    }();
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
  return notEq4(nlIndex2(true)(s))(Nothing.value);
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 74, column 24 - line 76, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 67, column 21 - line 69, column 16): " + [v.constructor.name]);
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 60, column 19 - line 62, column 15): " + [v.constructor.name]);
};
var allWs2 = /* @__PURE__ */ function() {
  var $78 = all2(isSpaceCU);
  return function($79) {
    return $78(toCharArray($79));
  };
}();
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
  throw new Error("Failed pattern match at MinBars.Standalone (line 55, column 17 - line 57, column 15): " + [v.constructor.name]);
};
var mustacheStandalone = function(toks0) {
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
    throw new Error("Failed pattern match at MinBars.Standalone (line 152, column 18 - line 157, column 47): " + [v.constructor.name]);
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
    throw new Error("Failed pattern match at MinBars.Standalone (line 139, column 17 - line 147, column 46): " + [v.constructor.name]);
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
        var s1 = function() {
          var $59 = standaloneAt(j - 1 | 0);
          if ($59) {
            return dropLeadingLine2(v.value0);
          }
          ;
          return v.value0;
        }();
        var s2 = function() {
          var $60 = standaloneAt(j + 1 | 0);
          if ($60) {
            return dropTrailingIndent2(s1);
          }
          ;
          return s1;
        }();
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
    throw new Error("Failed pattern match at MinBars.Standalone (line 121, column 16 - line 125, column 17): " + [v.constructor.name]);
  };
  var inject = function(i) {
    return function(v) {
      if (v instanceof RSep && (isPartialInterior(v.value2) && standaloneAt(i))) {
        return new RSep(v.value0, v.value1, v.value2 + (' "' + (indentAt(i) + '"')));
      }
      ;
      if (v instanceof ROpen && (v.value1 instanceof Parent && standaloneAt(i))) {
        return new ROpen(v.value0, Parent.value, v.value2, v.value3 + (' "' + (indentAt(i) + '"')));
      }
      ;
      if (v instanceof ROpen && (v.value1 instanceof BlockDef && standaloneAt(i))) {
        return new ROpen(v.value0, BlockDef.value, v.value2, v.value3 + (' "' + (indentAt(i) + '"')));
      }
      ;
      return v;
    };
  };
  return mapWithIndex2(inject)(trimmed);
};

// output/MinBars.Surface/index.js
var $runtime_lazy5 = function(name2, moduleName, init) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init();
    state2 = 2;
    return val;
  };
};
var map20 = /* @__PURE__ */ map(functorMaybe);
var Static = /* @__PURE__ */ function() {
  function Static2(value0) {
    this.value0 = value0;
  }
  ;
  Static2.create = function(value0) {
    return new Static2(value0);
  };
  return Static2;
}();
var Dynamic = /* @__PURE__ */ function() {
  function Dynamic2(value0) {
    this.value0 = value0;
  }
  ;
  Dynamic2.create = function(value0) {
    return new Dynamic2(value0);
  };
  return Dynamic2;
}();
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
  throw new Error("Failed pattern match at MinBars.Surface (line 153, column 19 - line 155, column 32): " + [v.constructor.name]);
};
var partialExpr2 = function(pn) {
  return function(indent) {
    var nameExpr = function() {
      if (pn instanceof Static) {
        return new Lit(new VString(pn.value0));
      }
      ;
      if (pn instanceof Dynamic) {
        return mlookup(pn.value0);
      }
      ;
      throw new Error("Failed pattern match at MinBars.Surface (line 171, column 14 - line 173, column 33): " + [pn.constructor.name]);
    }();
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
  throw new Error("Failed pattern match at MinBars.Surface (line 82, column 12 - line 85, column 15): " + [v.constructor.name]);
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
  var args = function() {
    var v2 = last(args0);
    if (v2 instanceof Just && (v2.value0 instanceof Lit && v2.value0.value0 instanceof VString)) {
      return dropEnd(1)(args0);
    }
    ;
    return args0;
  }();
  var v = map20(argName)(head(args));
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
    throw new Error("Failed pattern match at MinBars.Surface (line 111, column 13 - line 117, column 24): " + [v1.constructor.name]);
  }
  ;
  if (v instanceof Nothing) {
    return new Static("");
  }
  ;
  throw new Error("Failed pattern match at MinBars.Surface (line 110, column 21 - line 118, column 23): " + [v.constructor.name]);
};
var $lazy_desugar = /* @__PURE__ */ $runtime_lazy5("desugar", "MinBars.Surface", function() {
  var node = function(v) {
    if (v instanceof Content) {
      return new Content(v.value0);
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
      return new Block(v.value0, Section.value, "section", [mlookup(v.value2)], $lazy_desugar(58)(v.value4));
    }
    ;
    if (v instanceof Block && v.value1 instanceof Inverse) {
      return new Block(v.value0, Section.value, "inverted", [mlookup(v.value2)], $lazy_desugar(60)(v.value4));
    }
    ;
    if (v instanceof Block && v.value1 instanceof Parent) {
      return new Block(v.value0, Section.value, "parent", [parentName(v.value2), new Lit(new VString(indentArg(v.value3)))], $lazy_desugar(67)(v.value4));
    }
    ;
    if (v instanceof Block && v.value1 instanceof BlockDef) {
      return new Block(v.value0, Section.value, "block", cons(new Lit(new VString(v.value2)))(indentArgs(v.value3)), $lazy_desugar(75)(v.value4));
    }
    ;
    if (v instanceof RawBlock) {
      return new RawBlock(v.value0, v.value1, v.value2, v.value3);
    }
    ;
    throw new Error("Failed pattern match at MinBars.Surface (line 43, column 10 - line 77, column 59): " + [v.constructor.name]);
  };
  return map(functorArray)(node);
});
var desugar2 = /* @__PURE__ */ $lazy_desugar(40);

// output/MinBars/index.js
var bind7 = /* @__PURE__ */ bind(bindEither);
var pure3 = /* @__PURE__ */ pure(applicativeEither);
var runTemplate2 = /* @__PURE__ */ runTemplate(monadEither);
var minEngine2 = /* @__PURE__ */ minEngine(monadThrowEither);
var traverse7 = /* @__PURE__ */ traverse(traversableArray)(applicativeEither);
var fromFoldable11 = /* @__PURE__ */ fromFoldable3(ordString)(foldableArray);
var elem7 = /* @__PURE__ */ elem(foldableList)(eqString);
var lookup6 = /* @__PURE__ */ lookup(ordString);
var union6 = /* @__PURE__ */ union(ordString);
var map21 = /* @__PURE__ */ map(functorEither);
var show13 = /* @__PURE__ */ show(showError);
var mapFlipped2 = /* @__PURE__ */ mapFlipped(functorEither);
var lmap2 = /* @__PURE__ */ lmap(bifunctorEither);
var minOptions = /* @__PURE__ */ function() {
  return {
    parseExpr: defaultParseOptions.parseExpr,
    parseHead: defaultParseOptions.parseHead,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    lexOptions: defaultParseOptions.lexOptions,
    lexConfig: defaultParseOptions.lexConfig,
    extras: true,
    inheritance: true,
    trimStandalone: false
  };
}();
var parseMinWith = function(cfg) {
  return function(src) {
    return bind7(tokenizeTemplate(cfg)(src))(function(toks) {
      return bind7(collectDirectives(toks))(function(directives) {
        return bind7(buildFromTokens(minOptions)(mustacheStandalone(toks)))(function(nodes) {
          return pure3({
            directives,
            nodes
          });
        });
      });
    });
  };
};
var renderCoreWith = function(cfg) {
  return function(partials) {
    return function(src) {
      return function(dat) {
        var v = parseMinWith(cfg)(src);
        if (v instanceof Left) {
          return new Left(renderParseErrorAt(src)(v.value0));
        }
        ;
        if (v instanceof Right) {
          var v1 = resolveTruthinessWith(mustache)(v.value0.directives);
          if (v1 instanceof Left) {
            return new Left(formatError(src)(v1.value0));
          }
          ;
          if (v1 instanceof Right) {
            var seeded = seedEnv(dat)(partials)(v1.value0);
            var v2 = runTemplate2(minEngine2(seeded))(desugar2(v.value0.nodes));
            if (v2 instanceof Left) {
              return new Left(formatError(src)(v2.value0));
            }
            ;
            if (v2 instanceof Right) {
              return new Right(v2.value0);
            }
            ;
            throw new Error("Failed pattern match at MinBars (line 130, column 9 - line 132, column 33): " + [v2.constructor.name]);
          }
          ;
          throw new Error("Failed pattern match at MinBars (line 124, column 34 - line 132, column 33): " + [v1.constructor.name]);
        }
        ;
        throw new Error("Failed pattern match at MinBars (line 122, column 39 - line 132, column 33): " + [v.constructor.name]);
      };
    };
  };
};
var minMeta = function(falsy) {
  return {
    runtimeVersion,
    preamble: "const $falsy = " + (falsyLiteral(falsy) + ";\n"),
    seed: "rt.mseed(data, $falsy)"
  };
};
var minLexConfig = /* @__PURE__ */ function() {
  return {
    open: defaultLexConfig.open,
    close: defaultLexConfig.close,
    keepLongComments: defaultLexConfig.keepLongComments,
    mustacheDelims: true
  };
}();
var parseMin = /* @__PURE__ */ parseMinWith(minLexConfig);
var renderCore = /* @__PURE__ */ renderCoreWith(minLexConfig);
var renderMinWith = function(partialSrcs) {
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
        throw new Error("Failed pattern match at MinBars (line 103, column 35 - line 105, column 58): " + [v1.constructor.name]);
      };
      var v = traverse7(compilePartial)(partialSrcs);
      if (v instanceof Left) {
        return new Left(v.value0);
      }
      ;
      if (v instanceof Right) {
        return renderCore(fromFoldable11(v.value0))(src)(dat);
      }
      ;
      throw new Error("Failed pattern match at MinBars (line 99, column 3 - line 101, column 57): " + [v.constructor.name]);
    };
  };
};
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
    throw new Error("Failed pattern match at MinBars (line 255, column 1 - line 255, column 66): " + [indent.constructor.name, body.constructor.name]);
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
              if (elem7(v["value1"]["value1"][0].value0.value0)(chain)) {
                return new Left(new DisallowedShape("recursive partial '" + (v["value1"]["value1"][0].value0.value0 + "' (MinBars compile)"), 0));
              }
              ;
              if (otherwise) {
                var v1 = lookup6(v["value1"]["value1"][0].value0.value0)(partials);
                if (v1 instanceof Nothing) {
                  return new Right([]);
                }
                ;
                if (v1 instanceof Just) {
                  return inline(partials)(overrides)(new Cons(v["value1"]["value1"][0].value0.value0, chain))(depth)(indentTemplate(v["value1"]["value1"][1].value0.value0)(v1.value0));
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 212, column 22 - line 214, column 99): " + [v1.constructor.name]);
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
                var v1 = lookup6(v["value3"][0].value0.value0)(partials);
                if (v1 instanceof Nothing) {
                  return new Right([]);
                }
                ;
                if (v1 instanceof Just) {
                  return inline(partials)(union6(overrides)(harvestBlocks(v.value4)))(chain)(depth + 1 | 0)(indentTemplate(v["value3"][1].value0.value0)(v1.value0));
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 221, column 22 - line 225, column 45): " + [v1.constructor.name]);
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
                var v2 = lookup6(v1.value0.value0.value0)(overrides);
                if (v2 instanceof Nothing) {
                  return recurse(v.value4);
                }
                ;
                if (v2 instanceof Just) {
                  return bind7(recurse(v2.value0))(function(inlinedOverride) {
                    var $106 = length(v.value3) >= 2;
                    if ($106) {
                      return bind7(expansionIndent(blockIndent(v.value3))(v.value4))(function(expand) {
                        return new Right([new Block(v.value0, Section.value, "@reindent", [new Lit(new VString(expand))], inlinedOverride)]);
                      });
                    }
                    ;
                    return new Right(inlinedOverride);
                  });
                }
                ;
                throw new Error("Failed pattern match at MinBars (line 230, column 36 - line 237, column 37): " + [v2.constructor.name]);
              }
              ;
              return new Left(new DisallowedShape("malformed block override (MinBars compile)", 0));
            }
            ;
            if (v instanceof Block) {
              return map21(function(b) {
                return [new Block(v.value0, v.value1, v.value2, v.value3, b)];
              })(recurse(v.value4));
            }
            ;
            return new Right([v]);
          };
          return map21(concat)(traverse7(one2)(tmpl));
        };
      };
    };
  };
};
var compileMinJsWith = function(partialSrcs) {
  return function(src) {
    var toParseError = function(v) {
      if (v instanceof DirectiveError) {
        return new BadDirective(v.value0, v.value1);
      }
      ;
      return new BadDirective(show13(v), 0);
    };
    var parsePartial = function(v) {
      return mapFlipped2(parseMin(v.value1))(function(r) {
        return new Tuple(v.value0, desugar2(r.nodes));
      });
    };
    return bind7(parseMin(src))(function(v) {
      return bind7(lmap2(toParseError)(resolveTruthinessWith(mustache)(v.directives)))(function(falsy) {
        return bind7(map21(fromFoldable11)(traverse7(parsePartial)(partialSrcs)))(function(partials) {
          return bind7(inline(partials)(empty3)(Nil.value)(0)(desugar2(v.nodes)))(function(inlined) {
            return new Right(compile(minMeta(falsy))(minEmit)([])(inlined));
          });
        });
      });
    });
  };
};
var compileMinJs = /* @__PURE__ */ compileMinJsWith([]);

// output/Effect.Aff/foreign.js
var Aff = function() {
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
  var Scheduler = function() {
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
  }();
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
    var step = aff;
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
              step = bhead(step);
              if (btail === null) {
                bhead = null;
              } else {
                bhead = btail._1;
                btail = btail._2;
              }
            } catch (e) {
              status = RETURN;
              fail = util.left(e);
              step = null;
            }
            break;
          case STEP_RESULT:
            if (util.isLeft(step)) {
              status = RETURN;
              fail = step;
              step = null;
            } else if (bhead === null) {
              status = RETURN;
            } else {
              status = STEP_BIND;
              step = util.fromRight(step);
            }
            break;
          case CONTINUE:
            switch (step.tag) {
              case BIND:
                if (bhead) {
                  btail = new Aff2(CONS, bhead, btail);
                }
                bhead = step._2;
                status = CONTINUE;
                step = step._1;
                break;
              case PURE:
                if (bhead === null) {
                  status = RETURN;
                  step = util.right(step._1);
                } else {
                  status = STEP_BIND;
                  step = step._1;
                }
                break;
              case SYNC:
                status = STEP_RESULT;
                step = runSync(util.left, util.right, step._1);
                break;
              case ASYNC:
                status = PENDING;
                step = runAsync(util.left, step._1, function(result3) {
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
                      step = result3;
                      run3(runTick);
                    });
                  };
                });
                return;
              case THROW:
                status = RETURN;
                fail = util.left(step._1);
                step = null;
                break;
              case CATCH:
                if (bhead === null) {
                  attempts = new Aff2(CONS, step, attempts, interrupt);
                } else {
                  attempts = new Aff2(CONS, step, new Aff2(CONS, new Aff2(RESUME, bhead, btail), attempts, interrupt), interrupt);
                }
                bhead = null;
                btail = null;
                status = CONTINUE;
                step = step._1;
                break;
              case BRACKET:
                bracketCount++;
                if (bhead === null) {
                  attempts = new Aff2(CONS, step, attempts, interrupt);
                } else {
                  attempts = new Aff2(CONS, step, new Aff2(CONS, new Aff2(RESUME, bhead, btail), attempts, interrupt), interrupt);
                }
                bhead = null;
                btail = null;
                status = CONTINUE;
                step = step._1;
                break;
              case FORK:
                status = STEP_RESULT;
                tmp = Fiber(util, supervisor, step._2);
                if (supervisor) {
                  supervisor.register(tmp);
                }
                if (step._1) {
                  tmp.run();
                }
                step = util.right(tmp);
                break;
              case SEQ:
                status = CONTINUE;
                step = sequential2(util, supervisor, step._1);
                break;
            }
            break;
          case RETURN:
            bhead = null;
            btail = null;
            if (attempts === null) {
              status = COMPLETED;
              step = interrupt || fail || step;
            } else {
              tmp = attempts._3;
              attempt = attempts._1;
              attempts = attempts._2;
              switch (attempt.tag) {
                case CATCH:
                  if (interrupt && interrupt !== tmp && bracketCount === 0) {
                    status = RETURN;
                  } else if (fail) {
                    status = CONTINUE;
                    step = attempt._2(util.fromLeft(fail));
                    fail = null;
                  }
                  break;
                case RESUME:
                  if (interrupt && interrupt !== tmp && bracketCount === 0 || fail) {
                    status = RETURN;
                  } else {
                    bhead = attempt._1;
                    btail = attempt._2;
                    status = STEP_BIND;
                    step = util.fromRight(step);
                  }
                  break;
                case BRACKET:
                  bracketCount--;
                  if (fail === null) {
                    result2 = util.fromRight(step);
                    attempts = new Aff2(CONS, new Aff2(RELEASE, attempt._2, result2), attempts, tmp);
                    if (interrupt === tmp || bracketCount > 0) {
                      status = CONTINUE;
                      step = attempt._3(result2);
                    }
                  }
                  break;
                case RELEASE:
                  attempts = new Aff2(CONS, new Aff2(FINALIZED, step, fail), attempts, interrupt);
                  status = CONTINUE;
                  if (interrupt && interrupt !== tmp && bracketCount === 0) {
                    step = attempt._1.killed(util.fromLeft(interrupt))(attempt._2);
                  } else if (fail) {
                    step = attempt._1.failed(util.fromLeft(fail))(attempt._2);
                  } else {
                    step = attempt._1.completed(util.fromRight(step))(attempt._2);
                  }
                  fail = null;
                  bracketCount++;
                  break;
                case FINALIZER:
                  bracketCount++;
                  attempts = new Aff2(CONS, new Aff2(FINALIZED, step, fail), attempts, interrupt);
                  status = CONTINUE;
                  step = attempt._1;
                  break;
                case FINALIZED:
                  bracketCount--;
                  status = RETURN;
                  step = attempt._1;
                  fail = attempt._2;
                  break;
              }
            }
            break;
          case COMPLETED:
            for (var k in joins) {
              if (joins.hasOwnProperty(k)) {
                rethrow = rethrow && joins[k].rethrow;
                runEff(joins[k].handler(step));
              }
            }
            joins = null;
            if (interrupt && fail) {
              setTimeout(function() {
                throw util.fromLeft(fail);
              }, 0);
            } else if (util.isLeft(step) && rethrow) {
              setTimeout(function() {
                if (rethrow) {
                  throw util.fromLeft(step);
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
          join3.handler(step)();
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
            step = interrupt;
            run3(runTick);
            break;
          case PENDING:
            if (interrupt === null) {
              interrupt = util.left(error2);
            }
            if (bracketCount === 0) {
              if (status === PENDING) {
                attempts = new Aff2(CONS, new Aff2(FINALIZER, step(error2)), attempts, interrupt);
              }
              status = RETURN;
              step = null;
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
              step = null;
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
      var step = par2;
      var head3 = null;
      var tail = null;
      var count = 0;
      var kills2 = {};
      var tmp, kid;
      loop: while (true) {
        tmp = null;
        switch (step.tag) {
          case FORKED:
            if (step._3 === EMPTY) {
              tmp = fibers[step._1];
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
            step = head3._2;
            if (tail === null) {
              head3 = null;
            } else {
              head3 = tail._1;
              tail = tail._2;
            }
            break;
          case MAP:
            step = step._2;
            break;
          case APPLY:
          case ALT:
            if (head3) {
              tail = new Aff2(CONS, head3, tail);
            }
            head3 = step;
            step = step._1;
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
    function join2(result2, head3, tail) {
      var fail, step, lhs, rhs, tmp, kid;
      if (util.isLeft(result2)) {
        fail = result2;
        step = null;
      } else {
        step = result2;
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
          cb(fail || step)();
          return;
        }
        if (head3._3 !== EMPTY) {
          return;
        }
        switch (head3.tag) {
          case MAP:
            if (fail === null) {
              head3._3 = util.right(head3._1(util.fromRight(step)));
              step = head3._3;
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
                  } else if (tail === null) {
                    join2(fail, null, null);
                  } else {
                    join2(fail, tail._1, tail._2);
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
              step = util.right(util.fromRight(lhs)(util.fromRight(rhs)));
              head3._3 = step;
            }
            break;
          case ALT:
            lhs = head3._1._3;
            rhs = head3._2._3;
            if (lhs === EMPTY && util.isLeft(rhs) || rhs === EMPTY && util.isLeft(lhs)) {
              return;
            }
            if (lhs !== EMPTY && util.isLeft(lhs) && rhs !== EMPTY && util.isLeft(rhs)) {
              fail = step === lhs ? rhs : lhs;
              step = null;
              head3._3 = fail;
            } else {
              head3._3 = step;
              tmp = true;
              kid = killId++;
              kills[kid] = kill(early, step === lhs ? head3._2 : head3._1, function() {
                return function() {
                  delete kills[kid];
                  if (tmp) {
                    tmp = false;
                  } else if (tail === null) {
                    join2(step, null, null);
                  } else {
                    join2(step, tail._1, tail._2);
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
        if (tail === null) {
          head3 = null;
        } else {
          head3 = tail._1;
          tail = tail._2;
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
      var step = par;
      var head3 = null;
      var tail = null;
      var tmp, fid;
      loop: while (true) {
        tmp = null;
        fid = null;
        switch (status) {
          case CONTINUE:
            switch (step.tag) {
              case MAP:
                if (head3) {
                  tail = new Aff2(CONS, head3, tail);
                }
                head3 = new Aff2(MAP, step._1, EMPTY, EMPTY);
                step = step._2;
                break;
              case APPLY:
                if (head3) {
                  tail = new Aff2(CONS, head3, tail);
                }
                head3 = new Aff2(APPLY, EMPTY, step._2, EMPTY);
                step = step._1;
                break;
              case ALT:
                if (head3) {
                  tail = new Aff2(CONS, head3, tail);
                }
                head3 = new Aff2(ALT, EMPTY, step._2, EMPTY);
                step = step._1;
                break;
              default:
                fid = fiberId++;
                status = RETURN;
                tmp = step;
                step = new Aff2(FORKED, fid, new Aff2(CONS, head3, tail), EMPTY);
                tmp = Fiber(util, supervisor, tmp);
                tmp.onComplete({
                  rethrow: false,
                  handler: resolve(step)
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
              head3._1 = step;
              status = CONTINUE;
              step = head3._2;
              head3._2 = EMPTY;
            } else {
              head3._2 = step;
              step = head3;
              if (tail === null) {
                head3 = null;
              } else {
                head3 = tail._1;
                tail = tail._2;
              }
            }
        }
      }
      root = step;
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
}();
var _pure = Aff.Pure;
var _throwError = Aff.Throw;
var _liftEffect = Aff.Sync;
var makeAff = Aff.Async;
var _sequential = Aff.Seq;

// output/RawBars/index.js
var lmap3 = /* @__PURE__ */ lmap(bifunctorEither);
var runResolved2 = /* @__PURE__ */ runResolved(monadThrowEither);
var identity7 = /* @__PURE__ */ identity(categoryFn);
var bind8 = /* @__PURE__ */ bind(bindEither);
var pure1 = /* @__PURE__ */ pure(applicativeEither);
var coreOptions = /* @__PURE__ */ function() {
  return {
    trimStandalone: defaultParseOptions.trimStandalone,
    parseExpr: defaultParseOptions.parseExpr,
    parseHead: defaultParseOptions.parseHead,
    inheritance: defaultParseOptions.inheritance,
    standaloneSeps: defaultParseOptions.standaloneSeps,
    lexOptions: defaultParseOptions.lexOptions,
    extras: false,
    lexConfig: {
      open: defaultLexConfig.open,
      close: defaultLexConfig.close,
      keepLongComments: defaultLexConfig.keepLongComments,
      mustacheDelims: true
    }
  };
}();
var renderDiag = function(src) {
  return function(dat) {
    var v = parseWith(coreOptions)(src);
    if (v instanceof Left) {
      return new Left(renderParseErrorAt(src)(v.value0));
    }
    ;
    if (v instanceof Right) {
      return lmap3(formatError(src))(runResolved2(v.value0.directives)(identity7)(v.value0.nodes)(dat));
    }
    ;
    throw new Error("Failed pattern match at RawBars (line 75, column 22 - line 77, column 100): " + [v.constructor.name]);
  };
};
var compileJsWith = function(opts) {
  return function(src) {
    return bind8(parseWith({
      trimStandalone: opts.trimStandalone,
      parseExpr: opts.parseExpr,
      parseHead: opts.parseHead,
      inheritance: opts.inheritance,
      standaloneSeps: opts.standaloneSeps,
      lexOptions: opts.lexOptions,
      lexConfig: opts.lexConfig,
      extras: false
    })(src))(function(v) {
      return bind8(resolveForCompile(v.directives))(function(fs) {
        return pure1(compile(metaFor(fs))(fullbarsEmit)([])(v.nodes));
      });
    });
  };
};
var compileJs = /* @__PURE__ */ compileJsWith(coreOptions);

// output/FullBars.JS/index.js
var $runtime_lazy6 = function(name2, moduleName, init) {
  var state2 = 0;
  var val;
  return function(lineNumber) {
    if (state2 === 2) return val;
    if (state2 === 1) throw new ReferenceError(name2 + " was needed before it finished initializing (module " + moduleName + ", line " + lineNumber + ")", moduleName, lineNumber);
    state2 = 1;
    val = init();
    state2 = 2;
    return val;
  };
};
var show14 = /* @__PURE__ */ show(showNumber);
var map24 = /* @__PURE__ */ map(functorArray);
var pure4 = /* @__PURE__ */ pure(applicativeEither);
var identity8 = /* @__PURE__ */ identity(categoryFn);
var throwError2 = /* @__PURE__ */ throwError(monadThrowEither);
var show15 = /* @__PURE__ */ show(showError);
var toUnfoldable9 = /* @__PURE__ */ toUnfoldable2(unfoldableArray);
var fromFoldable12 = /* @__PURE__ */ fromFoldable2(foldableArray);
var elem8 = /* @__PURE__ */ elem2(eqString);
var str = id;
var tt2 = function(t) {
  return new Tuple("t", str(t));
};
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
var renderWith = function(helpers, partials, tpl, json) {
  var mk = function(name2) {
    return function(fn) {
      return function(ctl) {
        return function(args) {
          var $43 = $$null(ctl.children);
          if ($43) {
            var v = callJsHelperImpl(name2)(fn)(map24(toJson)(args));
            if (v.tag === "safe") {
              return pure4(new VSafe(caseJsonString("")(identity8)(v.payload)));
            }
            ;
            if (v.tag === "arity") {
              return throwError2(new ArityError(caseJsonString("")(identity8)(v.payload)));
            }
            ;
            if (v.tag === "error") {
              return throwError2(new HelperError(caseJsonString("")(identity8)(v.payload)));
            }
            ;
            if (otherwise) {
              return pure4(fromJson(v.payload));
            }
            ;
            throw new Error("Failed pattern match at FullBars.JS (line 148, column 39 - line 153, column 51): " + [v.constructor.name]);
          }
          ;
          var renderClause = function(nodes) {
            return function(ctxJson) {
              var v2 = ctl.render(pushFrame(empty3)(fromJson(ctxJson))(ctl.env))(nodes);
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
              throw new Error("Failed pattern match at FullBars.JS (line 158, column 13 - line 160, column 64): " + [v2.constructor.name]);
            };
          };
          var clause = ctl.clause("else");
          var r = callJsBlockHelperImpl(name2)(fn)(map24(toJson)(args))(toJson(refContext(ctl.env)))(renderClause(clause.before))(renderClause(fromMaybe([])(clause.body)));
          if (r.tag === "arity") {
            return throwError2(new ArityError(caseJsonString("")(identity8)(r.payload)));
          }
          ;
          if (r.tag === "error") {
            return throwError2(new HelperError(caseJsonString("")(identity8)(r.payload)));
          }
          ;
          return pure4(new VSafe(caseJsonString("")(identity8)(r.payload)));
        };
      };
    };
  };
  var hs = map24(function(v) {
    return new Tuple(v.value0, mk(v.value0)(v.value1));
  })(toUnfoldable9(helpers));
  return result(renderSurfaceWithHelpers(hs)(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderSurfaceWithPartials = function(partials, tpl, json) {
  return result(renderSurfaceWith(toUnfoldable9(partials))(tpl)(fromJson(json)));
};
var renderSurface = function(tpl, json) {
  return result(renderSurfaceDiag(tpl)(fromJson(json)));
};
var renderMustache = function(partials, tpl, json) {
  return result(renderMinWith(toUnfoldable9(partials))(tpl)(fromJson(json)));
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
  return id(fromFoldable12(kvs));
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
var $$int = function(n) {
  return id(toNumber(n));
};
var highlightConfig = /* @__PURE__ */ function() {
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
        lexOptions: maxOptions.lexOptions,
        clauseSeps: maxOptions.standaloneSeps
      };
    }
    ;
    if (v === "rawbars") {
      return {
        lexConfig: withSetDelims,
        lexOptions: defaultLexOptions,
        clauseSeps: kernelClauses
      };
    }
    ;
    if (v === "minbars") {
      return {
        lexConfig: withSetDelims,
        lexOptions: defaultLexOptions,
        clauseSeps: []
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
      lexOptions: defaultLexOptions,
      clauseSeps: kernelClauses
    };
  };
}();
var highlightSpans2 = function(tpl, dialect) {
  return highlightSpans(highlightConfig(dialect))(tpl);
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
    throw new Error("Failed pattern match at FullBars.JS (line 219, column 23 - line 221, column 49): " + [v.constructor.name]);
  };
};
var compileSurface2 = function(tpl) {
  return compileResultAt(tpl)(compileSurface(tpl));
};
var compileMinbarsWithPartials = function(partials, tpl) {
  return compileResultAt(tpl)(compileMinJsWith(toUnfoldable9(partials))(tpl));
};
var compileMinbars = function(tpl) {
  return compileResultAt(tpl)(compileMinJs(tpl));
};
var compileMaxbars = function(tpl) {
  return compileResultAt(tpl)(compileMaxJs(tpl));
};
var compileFor = function(dialect, tpl) {
  return compileResultAt(tpl)(function() {
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
  }());
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
    var $74 = elem8(v.value0)(dataVars);
    if ($74) {
      return obj([tt2(v.value0)]);
    }
    ;
    return obj([tt2("identifier"), new Tuple("name", str(v.value0))]);
  }
  ;
  if (v instanceof App2) {
    return obj([tt2("call"), new Tuple("name", str(v.value0)), new Tuple("args", arr(map24(argOf)(v.value1)))]);
  }
  ;
  throw new Error("Failed pattern match at FullBars.JS (line 385, column 9 - line 394, column 99): " + [v.constructor.name]);
};
var path = function(args) {
  var v = uncons(args);
  if (v instanceof Just && (v.value0.head instanceof App2 && (v.value0.head.value0 === "this" && v.value0.head.value1.length === 0))) {
    var $80 = $$null(v.value0.tail);
    if ($80) {
      return ctx("this");
    }
    ;
    return obj([tt2("path"), new Tuple("segments", arr(map24(segment)(v.value0.tail)))]);
  }
  ;
  return obj([tt2("call"), new Tuple("name", str("lookup")), new Tuple("args", arr(map24(argOf)(args)))]);
};
var argOf = function(e) {
  return obj([new Tuple("value", rexpr(e))]);
};
var $lazy_rnode = /* @__PURE__ */ $runtime_lazy6("rnode", "FullBars.JS", function() {
  var children = function(ns) {
    return arr(map24($lazy_rnode(361))(ns));
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
        return obj([tt2("emit"), new Tuple("expr", rexpr(v.value1)), new Tuple("escape", str(function() {
          if (v.value0) {
            return "html";
          }
          ;
          return "none";
        }()))]);
      }
      ;
      throw new Error("Failed pattern match at FullBars.JS (line 335, column 21 - line 342, column 10): " + [v1.constructor.name]);
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
          return obj([tt2(v.value0), new Tuple("args", arr(map24(argOf)(v.value1))), new Tuple("body", children(v.value2))]);
        }
        ;
        if (v instanceof RSep2) {
          return obj([tt2("sep"), new Tuple("name", str(v.value0)), new Tuple("args", arr(map24(argOf)(v.value1)))]);
        }
        ;
        if (v instanceof RRaw2) {
          return obj([tt2("raw"), new Tuple("text", str(v.value0))]);
        }
        ;
        throw new Error("Failed pattern match at FullBars.JS (line 330, column 1 - line 330, column 23): " + [v.constructor.name]);
      };
      if (v instanceof RCall && v.value0 === "partial") {
        var $113 = litName(v.value1);
        if ($113 instanceof Just) {
          return obj([tt2("partial"), new Tuple("name", str($113.value0)), new Tuple("body", children(v.value2))]);
        }
        ;
        return v3(true);
      }
      ;
      return v3(true);
    };
    if (v instanceof RCall && v.value0 === "inline") {
      var $119 = litName(v.value1);
      if ($119 instanceof Just) {
        return obj([tt2("inline"), new Tuple("name", str($119.value0)), new Tuple("body", children(v.value2))]);
      }
      ;
      return v1(true);
    }
    ;
    return v1(true);
  };
});
var rnode = /* @__PURE__ */ $lazy_rnode(330);
var astJson = function(dialect, src) {
  var v = function() {
    var $124 = dialect === "maxbars";
    if ($124) {
      return parseWith(maxOptions);
    }
    ;
    return parse;
  }()(src);
  if (v instanceof Left) {
    var d = parseErrorAt(src)(v.value0);
    return obj([new Tuple("error", obj([new Tuple("message", str(d.message)), new Tuple("start", $$int(d.offset)), new Tuple("end", $$int(d.offset))]))]);
  }
  ;
  if (v instanceof Right) {
    var desugared = function() {
      if (dialect === "core") {
        return v.value0.nodes;
      }
      ;
      if (dialect === "maxbars") {
        return desugarSurfaceWith(maxLoopVars)(v.value0.nodes);
      }
      ;
      return desugarSurface(v.value0.nodes);
    }();
    var nodes = lower(desugared);
    return obj([new Tuple("ast", obj([new Tuple("version", str("flatbars-ast/v1")), new Tuple("nodes", arr(map24(rnode)(nodes)))]))]);
  }
  ;
  throw new Error("Failed pattern match at FullBars.JS (line 273, column 3 - line 302, column 12): " + [v.constructor.name]);
};
export {
  astJson,
  compile2 as compile,
  compileFor,
  compileMaxbars,
  compileMinbars,
  compileMinbarsWithPartials,
  compileSurface2 as compileSurface,
  highlightSpans2 as highlightSpans,
  render,
  renderMaxbars,
  renderMinbars,
  renderMustache,
  renderSurface,
  renderSurfaceWithPartials,
  renderWith,
  safe
};
