-- | The helper environment. See `docs/modules/ROOT/pages/evaluation.adoc` §3.3.
-- |
-- | `helpers` is a stack of frames; name resolution searches inner-to-outer.
-- | A block helper pushes a frame for its body and pops it afterwards — this is
-- | the whole of "scope". `context` is the current data, reached only via the
-- | `this` helper.
-- |
-- | v1 fixes the result monad to `Either Error` (pure). `Helper` is a newtype so
-- | that the otherwise-cyclic synonyms (`Env` mentions `Helper`, `Helper`
-- | mentions `Env`/`Blocks`) are well-founded.
module BareBars.Env
  ( Helper(..)
  , Blocks
  , BlockBranch
  , Env
  , runHelper
  , constHelper
  , emptyBlocks
  , emptyEnv
  , register
  , registerAll
  , lookupHelper
  , pushFrame
  , pushHelpers
  ) where

import BareBars.Error (Error)
import BareBars.Value (Value)
import Data.Either (Either(..))
import Data.Foldable (foldl)
import Data.List (List(..), (:))
import Data.Map (Map)
import Data.Map as Map
import Data.Maybe (Maybe(..))
import Data.Tuple (Tuple(..))

newtype Helper = Helper (Env -> Array Value -> Blocks -> Either Error Value)

-- | The captured sub-templates handed to a block helper. `body` is the primary
-- | segment; `branches` are the alternatives introduced by inline separators
-- | (`{{else}}`, `{{elif c}}`, …). The core attaches no meaning to a branch's
-- | `sep` name — a helper decides what (if anything) each name means. For a
-- | non-block application `Blocks` is `emptyBlocks`.
type Blocks =
  { body :: Env -> Either Error String
  , branches :: Array BlockBranch
  }

-- | One block alternative: the separator name, its evaluated arguments, and a
-- | thunk that renders the segment that followed it.
type BlockBranch =
  { sep :: String
  , args :: Array Value
  , render :: Env -> Either Error String
  }

type Env =
  { helpers :: List (Map String Helper)
  , context :: Value
  }

runHelper :: Helper -> Env -> Array Value -> Blocks -> Either Error Value
runHelper (Helper f) = f

-- | A nullary helper that always returns a fixed value (the common case for
-- | scoped helpers like `index`, `first`, `this`).
constHelper :: Value -> Helper
constHelper v = Helper \_ _ _ -> Right v

emptyBlocks :: Blocks
emptyBlocks = { body: \_ -> Right "", branches: [] }

-- | An environment with the given context and a single empty helper frame.
emptyEnv :: Value -> Env
emptyEnv ctx = { helpers: Map.empty : Nil, context: ctx }

-- | Register a helper into the innermost frame.
register :: String -> Helper -> Env -> Env
register name h env = case env.helpers of
  Nil -> env { helpers = Map.singleton name h : Nil }
  top : rest -> env { helpers = Map.insert name h top : rest }

registerAll :: Array (Tuple String Helper) -> Env -> Env
registerAll pairs env = foldl (\e (Tuple n h) -> register n h e) env pairs

-- | Resolve a helper name, searching frames inner-to-outer.
lookupHelper :: String -> Env -> Maybe Helper
lookupHelper name env = go env.helpers
  where
  go Nil = Nothing
  go (m : rest) = case Map.lookup name m of
    Just h -> Just h
    Nothing -> go rest

-- | Push a new frame and set a new context (what `this` returns in the body).
pushFrame :: Map String Helper -> Value -> Env -> Env
pushFrame frame ctx env = env { helpers = frame : env.helpers, context = ctx }

-- | Push a new helper frame without changing the context.
pushHelpers :: Map String Helper -> Env -> Env
pushHelpers frame env = env { helpers = frame : env.helpers }
