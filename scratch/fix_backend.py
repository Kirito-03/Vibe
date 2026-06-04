import re

def main():
    path_downloads = "backend/src/routes/downloads.ts"
    with open(path_downloads, "r", encoding="utf-8") as f:
        content_downloads = f.read()
        
    helper_backend = """
const cleanSourceValue = (value: any): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '' || s === 'null' || s === 'undefined' || s === 'NaN' || s === 'dl-null' || s === '/api/downloads/stream/null' || s.endsWith('/stream/null') || s.includes('watch?v=null')) {
    return null;
  }
  return s;
};
"""
    if "cleanSourceValue" not in content_downloads:
        content_downloads = content_downloads.replace("import { asyncHandler }", helper_backend + "\nimport { asyncHandler }")
        if "import { asyncHandler }" not in content_downloads:
             content_downloads = helper_backend + "\n" + content_downloads

    old_dl_post = """router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const reqId = makeReqId();
  try {
    const { url, title, uploader, mode, format, override_id, expected_size } = req.body;
    let { youtube_id } = req.body;"""
    
    new_dl_post = """router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const reqId = makeReqId();
  try {
    let { url, title, uploader, mode, format, override_id, expected_size, youtube_id } = req.body;
    
    youtube_id = cleanSourceValue(youtube_id);
    url = cleanSourceValue(url);
    
    if (!youtube_id && !url) {
       console.log('[downloads] rejected invalid source youtubeId=null');
       return res.status(400).json({
         ok: false,
         code: "MISSING_TRACK_SOURCE",
         message: "Missing youtubeId/sourceId/url"
       });
    }
    
    if (url && String(url).includes('watch?v=null')) {
       console.log('[downloads] rejected invalid url watch?v=null');
       return res.status(400).json({
         ok: false,
         code: "MISSING_TRACK_SOURCE",
         message: "Missing youtubeId/sourceId/url"
       });
    }"""
    
    if "router.post('/', asyncHandler(async (req: Request, res: Response) => {" in content_downloads:
        # We need a more flexible replace because the destructured properties might differ
        match = re.search(r"router\.post\('/', asyncHandler\(async \(req: Request, res: Response\) => \{\n  const reqId = makeReqId\(\);\n  try \{\n    const \{.*\} = req\.body;\n(.*)?", content_downloads)
        if match:
             pass

    # Alternative flexible replace
    old_post_start = """router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const reqId = makeReqId();
  try {"""
  
    new_post_start = """router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const reqId = makeReqId();
  try {
    req.body.youtube_id = cleanSourceValue(req.body.youtube_id);
    req.body.url = cleanSourceValue(req.body.url);
    
    if (!req.body.youtube_id && !req.body.url) {
       console.log('[downloads] rejected invalid source youtubeId=null');
       return res.status(400).json({
         ok: false,
         code: "MISSING_TRACK_SOURCE",
         message: "Missing youtubeId/sourceId/url"
       });
    }
    
    if (req.body.url && String(req.body.url).includes('watch?v=null')) {
       console.log('[downloads] rejected invalid url watch?v=null');
       return res.status(400).json({
         ok: false,
         code: "MISSING_TRACK_SOURCE",
         message: "Missing youtubeId/sourceId/url"
       });
    }"""
    
    content_downloads = content_downloads.replace(old_post_start, new_post_start)
    
    old_dl_status = """router.get('/status/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;"""
    
    new_dl_status = """router.get('/status/:jobId', asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  if (!jobId || jobId === 'audio:null' || String(jobId).includes('null')) {
    return res.status(400).json({ status: 'failed', message: 'INVALID_JOB_ID' });
  }"""
    
    content_downloads = content_downloads.replace(old_dl_status, new_dl_status)
    
    with open(path_downloads, "w", encoding="utf-8") as f:
        f.write(content_downloads)

if __name__ == "__main__":
    main()
