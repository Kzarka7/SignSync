from fastapi import APIRouter, Query
from app.models.phrase import QuickPhrase, PhraseCategory
from app.data.phrases import PHRASES

router = APIRouter(prefix="/phrases", tags=["phrases"])


# Matches getPhrases(category?) in phrasesService.ts.
@router.get("", response_model=list[QuickPhrase])
def list_phrases(category: PhraseCategory | None = Query(default=None)):
    if category is not None:
        return [p for p in PHRASES if p.category == category]
    return PHRASES
