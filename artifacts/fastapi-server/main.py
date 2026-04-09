from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from routers import races, analysis_results, masters, batch_jobs, events, jobs, exports, audit

app = FastAPI(title="Horse Racing Data Correction API")


@app.get("/")
def root():
    """ブラウザで API ポートの / を開いたときに Swagger へ誘導（未設定だと 404 JSON になる）"""
    return RedirectResponse(url="/docs")

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
app.include_router(events.router)
app.include_router(jobs.router)
app.include_router(exports.router)
app.include_router(audit.router)



@app.get("/fastapi/healthz")
def health_check():
    return {"status": "ok"}
