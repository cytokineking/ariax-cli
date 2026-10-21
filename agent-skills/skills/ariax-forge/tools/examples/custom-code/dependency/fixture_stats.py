"""Local fixture dependency, recreated in a scratch virtual environment."""


def composition(sequence: str) -> dict:
    if not sequence or set(sequence) - set("ACGT"):
        raise ValueError("Fixture requires nonempty unambiguous DNA")
    return {"length": len(sequence), "gc_fraction": (sequence.count("G") + sequence.count("C")) / len(sequence)}
