from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from zkp_engine import run

app = FastAPI(
    title="Zero-Knowledge Proof Engine API",
    version="1.0.0",
)


class ProofRequest(BaseModel):
    protocol: Literal["qr", "schnorr", "fiat-shamir"]
    cheat: bool
    form: dict[str, str]


class ProofResponse(BaseModel):
    transcript: str


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/proof", response_model=ProofResponse)
def execute_proof(request: ProofRequest):
    transcript = run(
        protocol=request.protocol,
        cheat=request.cheat,
        form=request.form,
    )

    if transcript.startswith("Error:") or transcript.startswith("Missing input:"):
        raise HTTPException(status_code=400, detail=transcript)

    return ProofResponse(transcript=transcript)