from app.models.phrase import QuickPhrase

# Seeded with the same values as src/mocks/phrases.json.
PHRASES: list[QuickPhrase] = [
    QuickPhrase(id="p1", category="general", text="I need assistance"),
    QuickPhrase(id="p2", category="general", text="Thank you"),
    QuickPhrase(id="p3", category="general", text="Can you repeat that"),
    QuickPhrase(id="p4", category="medical", text="Please follow me"),
    QuickPhrase(id="p5", category="medical", text="Where does it hurt"),
    QuickPhrase(id="p6", category="medical", text="Take a deep breath"),
    QuickPhrase(id="p7", category="school", text="I have a question"),
    QuickPhrase(id="p8", category="school", text="Please wait a moment"),
    QuickPhrase(id="p9", category="government", text="I need to file a request"),
]
