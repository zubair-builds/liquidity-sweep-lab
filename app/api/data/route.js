import fs from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get('file');

  const manifestPath = path.join(process.cwd(), 'data', 'manifest.json');
  
  if (!file) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      return NextResponse.json({ datasets: manifest.datasets });
    } catch (e) {
      return NextResponse.json({ error: 'Manifest not found' }, { status: 500 });
    }
  }

  // Prevent directory traversal
  const safeFile = path.basename(file);
  const filePath = path.join(process.cwd(), 'data', safeFile);

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return NextResponse.json(JSON.parse(content));
  } catch (error) {
    return NextResponse.json({ error: 'File not found or unreadable' }, { status: 500 });
  }
}
