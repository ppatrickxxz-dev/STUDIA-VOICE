from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import os
import uuid

app = FastAPI(title="STUDIA-VOICE RVC Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("uploads", exist_ok=True)
os.makedirs("outputs", exist_ok=True)

app.mount("/outputs", StaticFiles(directory="outputs"), name="outputs")

@app.get("/")
def check_status():
    return {"status": "online", "message": "STUDIA-VOICE API live"}

@app.post("/api/convert-voice")
async def convert_voice(model_name: str = Form(...), file: UploadFile = File(...)):
    file_id = str(uuid.uuid4())
    input_filename = f"{file_id}_{file.filename}"
    output_filename = f"rvc_{file_id}_{os.path.splitext(file.filename)[0]}.mp3"
    
    input_path = f"uploads/{input_filename}"
    output_path = f"outputs/{output_filename}"

    try:
        with open(input_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        shutil.copyfile(input_path, output_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"status": "converted", "output_url": f"/outputs/{output_filename}"}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
