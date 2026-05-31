-- | Bridge between JSON and `Value`. Hosts (CLI, playground) take template data
-- | as JSON; this converts it into the core `Value` type. (YAML hosts convert
-- | YAML → JSON first, then call `fromJson`.)
module BareBars.Json
  ( fromJson
  , toJson
  , parseValue
  ) where

import Prelude

import BareBars.Value (Value(..))
import Data.Argonaut (Json, caseJson, fromArray, fromBoolean, fromNumber, fromObject, fromString, jsonNull, jsonParser)
import Data.Either (Either)
import Data.Map as Map
import Data.Tuple (Tuple(..))
import Foreign.Object as FO

fromJson :: Json -> Value
fromJson = caseJson
  (\_ -> VNull)
  VBool
  VNumber
  VString
  (\arr -> VArray (map fromJson arr))
  ( \obj -> VObject
      ( Map.fromFoldable
          ( map (\(Tuple k v) -> Tuple k (fromJson v))
              (FO.toUnfoldable obj :: Array (Tuple String Json))
          )
      )
  )

toJson :: Value -> Json
toJson = case _ of
  VString s -> fromString s
  VSafe s -> fromString s
  VNumber n -> fromNumber n
  VBool b -> fromBoolean b
  VNull -> jsonNull
  VArray xs -> fromArray (map toJson xs)
  VObject m -> fromObject
    ( FO.fromFoldable
        ( map (\(Tuple k v) -> Tuple k (toJson v))
            (Map.toUnfoldable m :: Array (Tuple String Value))
        )
    )

-- | Parse a JSON string into a `Value`. Returns the parser's error message on
-- | failure.
parseValue :: String -> Either String Value
parseValue s = fromJson <$> jsonParser s
