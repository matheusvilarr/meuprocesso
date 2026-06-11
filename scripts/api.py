"""
Meu Processo — Backend Python
Serve o scraper PJe e o monitor DJe do TJDFT como API REST local.

Iniciar:
    cd scripts && python api.py
    # ou: uvicorn api:app --port 8000 --reload

Endpoints:
    GET  /health                — verificação de status
    POST /pje   { numero_processo }     — scraper PJe TJDFT
    POST /dje   { oab, data? }          — monitor DJe TJDFT
"""

import os
import sys
import datetime
import asyncio
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(__file__))
from scraper_pje import buscar_historico


# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="Meu Processo — Backend Python", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


# ─── PJe TJDFT ────────────────────────────────────────────────────────────────

class PjeRequest(BaseModel):
    numero_processo: str


@app.post("/pje")
async def pje(req: PjeRequest):
    """Busca partes e andamentos de um processo no portal PJe do TJDFT."""
    numero = req.numero_processo.strip()
    if not numero:
        raise HTTPException(status_code=400, detail="numero_processo é obrigatório.")
    try:
        resultado = await buscar_historico(numero)
        return resultado
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── DJe TJDFT ────────────────────────────────────────────────────────────────

class DjeRequest(BaseModel):
    oab: str
    data: Optional[str] = None  # YYYY-MM-DD; None = hoje


@app.post("/dje")
def dje(req: DjeRequest):
    """Baixa o DJe do TJDFT e localiza intimações pelo número OAB."""
    from monitor_dje import monitorar

    oab = req.oab.strip()
    if not oab:
        raise HTTPException(status_code=400, detail="oab é obrigatório.")

    data: datetime.date | None = None
    if req.data:
        try:
            data = datetime.date.fromisoformat(req.data)
        except ValueError:
            raise HTTPException(status_code=400, detail="Formato de data inválido. Use YYYY-MM-DD.")

    try:
        resultados = monitorar(oab, data)
        return {"resultados": resultados}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
