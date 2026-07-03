Add-Type -AssemblyName System.Drawing

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class PublicAssetCleaner
{
    private static bool IsBackground(byte b, byte g, byte r, byte a)
    {
        if (a == 0) return true;
        byte max = Math.Max(r, Math.Max(g, b));
        byte min = Math.Min(r, Math.Min(g, b));
        return r >= 218 && g >= 218 && b >= 218 && (max - min) <= 24;
    }

    private static void AddPoint(int x, int y, int width, int height, int stride, byte[] pixels, bool[] visited, Queue<int> queue)
    {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        int key = (y * width) + x;
        if (visited[key]) return;
        int index = (y * stride) + (x * 4);
        if (!IsBackground(pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3])) return;
        visited[key] = true;
        queue.Enqueue(key);
    }

    public static void Clean(string inputPath, string outputPath)
    {
        using (Bitmap original = new Bitmap(inputPath))
        using (Bitmap bitmap = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.DrawImage(original, 0, 0, original.Width, original.Height);

            Rectangle area = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(area, ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            int bytes = Math.Abs(data.Stride) * data.Height;
            byte[] pixels = new byte[bytes];
            Marshal.Copy(data.Scan0, pixels, 0, bytes);

            int width = bitmap.Width;
            int height = bitmap.Height;
            bool[] visited = new bool[width * height];
            Queue<int> queue = new Queue<int>();

            for (int x = 0; x < width; x++)
            {
                AddPoint(x, 0, width, height, data.Stride, pixels, visited, queue);
                AddPoint(x, height - 1, width, height, data.Stride, pixels, visited, queue);
            }
            for (int y = 0; y < height; y++)
            {
                AddPoint(0, y, width, height, data.Stride, pixels, visited, queue);
                AddPoint(width - 1, y, width, height, data.Stride, pixels, visited, queue);
            }

            while (queue.Count > 0)
            {
                int key = queue.Dequeue();
                int x = key % width;
                int y = key / width;
                int index = (y * data.Stride) + (x * 4);
                pixels[index + 3] = 0;
                AddPoint(x + 1, y, width, height, data.Stride, pixels, visited, queue);
                AddPoint(x - 1, y, width, height, data.Stride, pixels, visited, queue);
                AddPoint(x, y + 1, width, height, data.Stride, pixels, visited, queue);
                AddPoint(x, y - 1, width, height, data.Stride, pixels, visited, queue);
            }

            Marshal.Copy(pixels, 0, data.Scan0, bytes);
            bitmap.UnlockBits(data);
            bitmap.Save(outputPath, ImageFormat.Png);
        }
    }

    public static void CropVisibleBounds(string inputPath, string outputPath)
    {
        using (Bitmap original = new Bitmap(inputPath))
        using (Bitmap bitmap = new Bitmap(original.Width, original.Height, PixelFormat.Format32bppArgb))
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.DrawImage(original, 0, 0, original.Width, original.Height);

            Rectangle area = new Rectangle(0, 0, bitmap.Width, bitmap.Height);
            BitmapData data = bitmap.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            int bytes = Math.Abs(data.Stride) * data.Height;
            byte[] pixels = new byte[bytes];
            Marshal.Copy(data.Scan0, pixels, 0, bytes);
            bitmap.UnlockBits(data);

            int minX = bitmap.Width;
            int minY = bitmap.Height;
            int maxX = -1;
            int maxY = -1;

            for (int y = 0; y < bitmap.Height; y++)
            {
                for (int x = 0; x < bitmap.Width; x++)
                {
                    int index = (y * data.Stride) + (x * 4);
                    if (pixels[index + 3] <= 8) continue;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }

            if (maxX < minX || maxY < minY)
            {
                bitmap.Save(outputPath, ImageFormat.Png);
                return;
            }

            int visibleWidth = maxX - minX + 1;
            int visibleHeight = maxY - minY + 1;
            int margin = Math.Max(8, (int)Math.Round(Math.Max(visibleWidth, visibleHeight) * 0.035));
            minX = Math.Max(0, minX - margin);
            minY = Math.Max(0, minY - margin);
            maxX = Math.Min(bitmap.Width - 1, maxX + margin);
            maxY = Math.Min(bitmap.Height - 1, maxY + margin);

            Rectangle crop = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
            using (Bitmap cropped = bitmap.Clone(crop, PixelFormat.Format32bppArgb))
            {
                cropped.Save(outputPath, ImageFormat.Png);
            }
        }
    }
}
"@

$sourceDir = Join-Path $PSScriptRoot '..\assets'
$targetDir = Join-Path $sourceDir 'clean'
$croppedDir = Join-Path $sourceDir 'cropped'
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
New-Item -ItemType Directory -Force -Path $croppedDir | Out-Null

Get-ChildItem -Path $sourceDir -Filter '*.png' -File | ForEach-Object {
  [PublicAssetCleaner]::Clean($_.FullName, (Join-Path $targetDir $_.Name))
}

@('eja.png', 'onda.png', 'epc.png', 'eju.png', 'pastor.png', 'girassol.png') | ForEach-Object {
  [PublicAssetCleaner]::CropVisibleBounds((Join-Path $targetDir $_), (Join-Path $croppedDir $_))
}
