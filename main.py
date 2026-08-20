# ==========================================
# main.py - STUDIA-VOICE Engine
# ==========================================
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import os
import uuid # Para IDs únicos de arquivos

app = FastAPI(title="STUDIA-VOICE RVC Engine")

# CONFIGURAÇÃO CORS (Permite que seu site na Vercel fale com a API no Render)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Troque pela URL da Vercel após o deploy final para segurança
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# CRIAÇÃO DE PASTAS DE TRABALHO
# Necessário para persistir dados temporários no plano gratuito do Render
os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

# SERVIR ARQUIVOS ESTÁTICOS
# Permite que o frontend acesse o áudio processado via URL
app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

# ROTA 1: Status Check (Teste Rápido)
@app.get("/")
def check_status():
    """Retorna se a API está online e pronta."""
    return {
        "status": "online",
        "gpu_ready": "NVIDIA CUDA Detected (Simulated)", # No plano free, roda em CPU
        "engine": "RVC v2 + Demucs (Ready)",
        "message": "STUDIA-VOICE API is live!"
    }

# ROTA 2: Conversão de Voz (Processo Principal)
@app.post("/api/convert-voice")
async def convert_voice(
    model_name: str = Form(..., description="Nome do modelo RVC a usar"),
    file: UploadFile = File(..., description="Arquivo de áudio de entrada")
):
    """
    Recebe áudio, simula processamento RVC+Demucs e retorna URL de download.
    (Implementação simplificada para Deploy inicial)
    """
    # 1. Gerar ID único para evitar conflitos de arquivos
    file_id = str(uuid.uuid4())
    input_filename = f"{file_id}_{file.filename}"
    output_filename = f"rvc_{file_id}_{os.path.splitext(file.filename)[0]}.mp3"
    
    input_path = f"uploads/{input_filename}"
    output_path = f"outputs/{output_filename}"

    try:
        # 2. Salvar áudio de entrada
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # ========================================================
        # [ESPAÇO RESERVADO PARA INTEGRAÇÃO DO CÓDIGO RVC v2/Demucs REAL]
        # ========================================================
        # Por enquanto, simulamos criando uma cópia do arquivo de entrada
        # como se fosse a saída processada (placeholder).
        shutil.copyfile(input_path, output_path)
        # ========================================================
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro interno no processamento: {str(e)}")

    # 3. Retornar dados da conversão
    return {
        "status": "converted",
        "conversion_id": file_id,
        "model_used": model_name,
        "input_file": file.filename,
        "output_url": f"/outputs/{output_filename}" # O frontend usará essa URL
    }

# ROTA 3: Exportar Mix (Endpoint Placeholder)
@app.get("/api/export-mix")
async def export_mix():
    """Simula a exportação da mixagem final."""
    return {
        "status": "mix_exported",
        "mix_id": str(uuid.uuid4()),
        "output_url": "/outputs/final_mix_placeholder.mp3",
        "message": "Mix processado com sucesso (simulação)."
    }

# Ponto de entrada para execução local (caso necessário)
if __name__ == "__main__":
    import uvicorn
    # A porta é lida da variável de ambiente PORT fornecida pelo Render
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main.py:app", host="0.0.0.0", port=port, reload=False)
