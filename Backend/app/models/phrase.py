from typing import Literal
from pydantic import BaseModel

PhraseCategory = Literal["medical", "school", "government", "general"]


# Mirrors src/types/phrase.ts -> QuickPhrase.
class QuickPhrase(BaseModel):
    id: str
    category: PhraseCategory
    text: str
