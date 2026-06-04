import re

def main():
    path = "backend/src/routes/user.ts"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()

    # Fix confirm check
    old_confirm = """    const confirm = String((req.body as any)?.confirm || '').trim();"""
    
    new_confirm = """    const confirm = String(
      (req.body as any)?.confirm || 
      (req.query as any)?.confirm || 
      req.headers['x-reset-confirm'] || 
      ''
    ).trim();"""

    if old_confirm in content:
        content = content.replace(old_confirm, new_confirm)

    # Add POST route
    old_routes = """router.post('/reset-data/preview', asyncHandler((req: Request, res: Response) => {
  (req as any).query = { ...(req as any).query, dryRun: 'true' };
  return previewOrReset(req, res);
}));
router.delete('/reset-data', asyncHandler(previewOrReset));"""

    new_routes = """router.post('/reset-data/preview', asyncHandler((req: Request, res: Response) => {
  (req as any).query = { ...(req as any).query, dryRun: 'true' };
  return previewOrReset(req, res);
}));
router.delete('/reset-data', asyncHandler(previewOrReset));
router.post('/reset-data/execute', asyncHandler(previewOrReset));"""

    if old_routes in content:
        content = content.replace(old_routes, new_routes)

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

if __name__ == "__main__":
    main()
