-- | Tests for the on-demand alias warning lint (`Linter.Aliases`, open decision
-- | 2: permanent + warn-on-demand). A use of a handlebars-legacy alias warns and
-- | points at the canonical name; the canonical helpers themselves do not.
module Test.Linter.Aliases (main) where

import Prelude

import Data.Array as Array
import Data.Either (Either(..))
import Data.String (Pattern(..), contains)
import Effect (Effect)
import Effect.Console (log)
import Linter.Aliases (aliasWarningsOf)
import Test.Assert (assert')

-- | The alias names warned for one template (or a parse-error marker).
warnNames :: String -> Array String
warnNames src = case aliasWarningsOf src of
  Left _ -> [ "<parse error>" ]
  Right issues -> map _.name issues

-- | Assert lifting `src` warns on exactly `names`, and (for a single name) that
-- | the message points at `canonical`.
expectWarns :: String -> String -> Array String -> Effect Unit
expectWarns name src names =
  assert' (name <> ": expected warns " <> show names <> " got " <> show (warnNames src))
    (warnNames src == names)

main :: Effect Unit
main = do
  log "Linter alias warnings"

  -- each legacy alias warns, pointing at its canonical name.
  expectWarns "plus warns" "{{{plus a b}}}" [ "plus" ]
  expectWarns "downcase warns" "{{{downcase s}}}" [ "downcase" ]
  expectWarns "upcase warns" "{{{upcase s}}}" [ "upcase" ]
  expectWarns "minus+times warn" "{{{minus a b}}}{{{times a b}}}" [ "minus", "times" ]

  -- the canonical helpers (and ordinary names) do NOT warn.
  expectWarns "add does not warn" "{{{add a b}}}" []
  expectWarns "lowercase does not warn" "{{{lowercase s}}}" []
  expectWarns "plain path does not warn" "{{{lookup this \"x\"}}}" []

  -- the canonical escaper is not an alias and so never warns.
  expectWarns "escapeHtml (canonical) does not warn" "{{{escapeHtml (lookup this \"x\")}}}" []

  -- the message names the canonical target.
  case aliasWarningsOf "{{{plus a b}}}" of
    Right [ issue ] -> assert' ("plus → add message, got: " <> issue.message)
      (contains (Pattern "add") issue.message)
    other -> assert' ("plus: expected one warning, got " <> show (map _.name <$> other)) false

  log "Linter alias-warning tests passed"
