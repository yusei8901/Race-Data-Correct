from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import races, analysis_results, masters, batch_jobs

app = FastAPI(title="Horse Racing Data Correction API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(races.router)
app.include_router(analysis_results.router)
app.include_router(masters.router)
app.include_router(batch_jobs.router)



@app.get("/fastapi/healthz")
def health_check():
    return {"status": "ok"}
