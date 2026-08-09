import fs from 'fs';
import path from 'path';

// 1. CẤU HÌNH BỘ LỌC TỰ ĐỘNG
const rootDir = "D:\\100_Active_Projects\\107_Trading_Crypto\\03_Workspace\\sandbox";
const outputFile = 'AI_CODEBASE.md';

// Các đuôi file được phép đọc (Thêm TS, config phổ biến)
const allowedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.md'];

// Các file cụ thể được phép đọc (không có đuôi)
const allowedFiles = ['.env.example', '.gitignore', 'Dockerfile'];

// Thư mục cần bỏ qua
const ignoredDirs = ['node_modules', '.git', 'dist', 'build', '.vercel', '.next', 'coverage', '.vscode', '.idea'];

// File cần bỏ qua (ĐẶC BIỆT QUAN TRỌNG: Bỏ qua file output và .env thật)
const ignoredFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', outputFile, '.DS_Store', '.env', '.env.local'];

// --- HÀM KIỂM TRA TÍNH HỢP LỆ ---
const isValidDir = (dirName) => !ignoredDirs.includes(dirName);
const isValidFile = (fileName) => {
    if (ignoredFiles.includes(fileName)) return false;
    if (allowedFiles.includes(fileName)) return true;
    const ext = path.extname(fileName);
    return allowedExtensions.includes(ext);
};

// --- HÀM VẼ SƠ ĐỒ CÂY THƯ MỤC CHUYÊN NGHIỆP ---
function generateTree(dir, prefix = '') {
    let treeStr = '';
    const items = fs.readdirSync(dir);
    
    // Lọc trước để biết chính xác số lượng item hợp lệ (dùng để vẽ nhánh cuối)
    const validItems = items.filter(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        return stat.isDirectory() ? isValidDir(item) : isValidFile(item);
    });

    validItems.forEach((item, index) => {
        const isLast = index === validItems.length - 1;
        const pointer = isLast ? '└── ' : '├── ';
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            treeStr += `${prefix}${pointer}${item}/\n`;
            // Nếu là thư mục cuối, khoảng trắng ở dưới; nếu không, kẻ vạch dọc
            treeStr += generateTree(fullPath, prefix + (isLast ? '    ' : '│   '));
        } else {
            treeStr += `${prefix}${pointer}${item}\n`;
        }
    });

    return treeStr;
}

// --- HÀM LẤY NỘI DUNG FILE ĐỆ QUY ---
function readFilesRecursively(dir) {
    let content = '';
    const items = fs.readdirSync(dir);

    items.forEach(item => {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && isValidDir(item)) {
            content += readFilesRecursively(fullPath);
        } else if (stat.isFile() && isValidFile(item)) {
            const fileContent = fs.readFileSync(fullPath, 'utf8');
            // Dùng path.relative để đường dẫn nhìn gọn gàng: src/App.jsx thay vì C:\...\src\App.jsx
            const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
            
            content += `=========================================\n`;
            content += `/// FILE: ${relativePath}\n`;
            content += `=========================================\n\n`;
            content += fileContent + `\n\n`;
        }
    });

    return content;
}

// ==========================================
// THỰC THI SCRIPT
// ==========================================
console.log('🔍 Đang quét toàn bộ dự án...');

const now = new Date();
const timeString = now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });

// 1. Khởi tạo nội dung và vẽ cây
let outputContent = `--- START OF FILE Paste ${timeString} ---\n\n`;
outputContent += `## 📂 SƠ ĐỒ KIẾN TRÚC HỆ THỐNG HIỆN TẠI\n\`\`\`text\n`;
outputContent += `.\n`; // Dấu chấm đại diện cho thư mục hiện tại
outputContent += generateTree(rootDir);
outputContent += `\`\`\`\n\n`;

// 2. Gom mã nguồn
outputContent += `## 💻 CHI TIẾT MÃ NGUỒN\n\n`;
outputContent += readFilesRecursively(rootDir);

// 3. Xuất file
fs.writeFileSync(outputFile, outputContent);
console.log(`✅ Đã quét xong! Toàn bộ kiến trúc và mã nguồn đã được gom vào: ${outputFile}`);