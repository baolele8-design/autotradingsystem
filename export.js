import fs from 'fs';
import path from 'path';

// 1. Chỉ định target paths
const targetPaths = [
    'src', 
    'api', 
    'package.json', 
    'vite.config.js', 
    'tailwind.config.js', 
    'index.html'
];
const outputFile = 'AI_CODEBASE.md';

const allowedExtensions = ['.js', '.jsx', '.json', '.html', '.css'];
const ignoredDirs = ['node_modules', '.git', 'dist', '.vercel', 'build'];

// --- THÊM MỚI: HÀM VẼ SƠ ĐỒ CÂY THƯ MỤC ---
function generateTree(currentPath, prefix = '') {
    if (!fs.existsSync(currentPath)) return '';

    const stat = fs.statSync(currentPath);
    const name = path.basename(currentPath);

    // Xử lý nếu là File
    if (stat.isFile()) {
        const ext = path.extname(currentPath);
        if ((allowedExtensions.includes(ext) || name === '.env.example') && name !== 'package-lock.json') {
            return `${prefix}├── ${name}\n`;
        }
        return '';
    }

    // Xử lý nếu là Thư mục
    if (stat.isDirectory()) {
        if (ignoredDirs.includes(name)) return '';

        let treeStr = `${prefix}├── ${name}/\n`;
        const files = fs.readdirSync(currentPath);
        files.forEach((file) => {
            // Đệ quy chui vào trong thư mục
            treeStr += generateTree(path.join(currentPath, file), prefix + '│   ');
        });
        return treeStr;
    }
    return '';
}
// ----------------------------------------

const now = new Date();
const timeString = now.toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute:'2-digit' });

// 2. KHỞI TẠO NỘI DUNG VỚI SƠ ĐỒ KIẾN TRÚC
let outputContent = `--- START OF FILE Paste ${timeString} ---\n\n`;
outputContent += `## 📂 SƠ ĐỒ KIẾN TRÚC HỆ THỐNG HIỆN TẠI\n\`\`\`text\n`;

// Vẽ cây cho từng thư mục/file target
targetPaths.forEach(p => {
    outputContent += generateTree(p);
});
outputContent += `\`\`\`\n\n`;
outputContent += `## 💻 CHI TIẾT MÃ NGUỒN\n\n`;

// 3. HÀM ĐỌC NỘI DUNG FILE (Giữ nguyên của bạn)
function readFilesRecursively(dir) {
    if (!fs.existsSync(dir)) return;
    
    const stat = fs.statSync(dir);
    
    if (stat.isFile()) {
        const ext = path.extname(dir);
        const fileName = path.basename(dir);
        
        if ((allowedExtensions.includes(ext) || fileName === '.env.example') && fileName !== 'package-lock.json') {
            const content = fs.readFileSync(dir, 'utf8');
            outputContent += `=========================================\n`;
            outputContent += `/// FILE: ${dir}\n`;
            outputContent += `=========================================\n\n`;
            outputContent += content;
            outputContent += `\n\n`;
        }
    } else if (stat.isDirectory()) {
        if (ignoredDirs.includes(path.basename(dir))) return;
        const files = fs.readdirSync(dir);
        files.forEach(file => readFilesRecursively(path.join(dir, file)));
    }
}

// Chạy thuật toán đệ quy lấy content
targetPaths.forEach(p => readFilesRecursively(p));

// Xuất file
fs.writeFileSync(outputFile, outputContent);
console.log(`✅ Đã gom mã nguồn và tạo Sơ đồ kiến trúc vào file ${outputFile}`);