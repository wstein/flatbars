-- | `flatbars-json` test suite (`spago test -p flatbars-json`).
-- |
-- | The JSON ⇄ `Value` bridge: `fromJson` shapes, `toJson` round-trips, and
-- | `parseValue` (string ⇒ `Value`) success and failure.
module Test.FlatBars.Json.Main where

import Prelude

import Data.Argonaut (jsonParser)
import Data.Either (Either(..), isLeft)
import Data.Map as Map
import Data.Tuple (Tuple(..))
import Effect (Effect)
import Effect.Console (log)
import FlatBars.Json (fromJson, parseValue, toJson)
import FlatBars.Value (Value(..))
import Test.Assert (assert')

-- Parse a JSON string to `Value` via the argonaut parser + `fromJson`, asserting
-- the parse itself succeeded.
expectFromJson :: String -> String -> Value -> Effect Unit
expectFromJson label src expected = case jsonParser src of
  Left e -> assert' (label <> ": JSON did not parse: " <> e) false
  Right j -> assert' (label <> ": fromJson mismatch") (fromJson j == expected)

main :: Effect Unit
main = do
  log "FlatBars JSON bridge tests"

  -- fromJson: every JSON shape maps to the matching Value.
  expectFromJson "null" "null" VNull
  expectFromJson "bool" "true" (VBool true)
  expectFromJson "number" "3.5" (VNumber 3.5)
  expectFromJson "int-as-number" "7" (VNumber 7.0)
  expectFromJson "string" "\"hi\"" (VString "hi")
  expectFromJson "array" "[1, \"a\"]" (VArray [ VNumber 1.0, VString "a" ])
  expectFromJson "object"
    "{\"name\": \"Ada\", \"admin\": true}"
    (VObject (Map.fromFoldable [ Tuple "name" (VString "Ada"), Tuple "admin" (VBool true) ]))
  expectFromJson "nested"
    "{\"user\": {\"tags\": [\"x\"]}}"
    (VObject (Map.singleton "user" (VObject (Map.singleton "tags" (VArray [ VString "x" ])))))

  -- toJson then back through fromJson is the identity on JSON-representable Values.
  let
    roundTrip v = fromJson (toJson v) == v
  assert' "round-trip string" (roundTrip (VString "x"))
  assert' "round-trip number" (roundTrip (VNumber 2.0))
  assert' "round-trip bool" (roundTrip (VBool false))
  assert' "round-trip null" (roundTrip VNull)
  assert' "round-trip array" (roundTrip (VArray [ VString "a", VNumber 1.0 ]))
  assert' "round-trip object"
    (roundTrip (VObject (Map.fromFoldable [ Tuple "k" (VString "v"), Tuple "n" (VNumber 1.0) ])))
  -- VSafe is not a JSON shape; toJson lowers it to a string, so it round-trips to VString.
  assert' "VSafe lowers to string" (fromJson (toJson (VSafe "m")) == VString "m")

  -- parseValue: success and failure.
  assert' "parseValue object"
    ( parseValue "{\"a\": 1}"
        == Right (VObject (Map.singleton "a" (VNumber 1.0)))
    )
  assert' "parseValue invalid is Left" (isLeft (parseValue "{not json"))

  log "all JSON bridge tests passed"
