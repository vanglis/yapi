const fs = require('fs');
const path = require('path');
const child_process = require('child_process');

const PLUGIN_DIR = path.join(process.cwd(), 'exts', 'yapi-plugin-gen-code');
const TASKS_DIR = path.join(PLUGIN_DIR, 'tasks');

function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8'); }
function readLastBytes(file, maxBytes) {
  try {
    if (!fs.existsSync(file)) return '';
    const stats = fs.statSync(file);
    const size = stats.size;
    if (size === 0) return '';
    const readSize = Math.min(maxBytes, size);
    const fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, size - readSize);
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (e) { return ''; }
}

(async function(){
  try {
    if (!fs.existsSync(TASKS_DIR)) fs.mkdirSync(TASKS_DIR, { recursive: true });

    const jarPath = path.join(process.cwd(), 'modules', 'openapi-generator-cli', 'target', 'openapi-generator-cli.jar');
    const filename = path.join(process.cwd(), 'static', 'attachment', 'gen-code-11', 'openapi-1762392791249.json');
    const templatePath = path.join(process.cwd(), 'modules', 'openapi-generator', 'src', 'main', 'resources', 'Java');
    const outDir = path.join(process.cwd(), 'data');
    const apiName = path.basename(filename, '.json');
    const finalOutDir = path.join(outDir, apiName);
    if (!fs.existsSync(finalOutDir)) fs.mkdirSync(finalOutDir, { recursive: true });

    const args = ['-jar', jarPath, 'generate', '-i', filename, '-g', 'java', '-t', templatePath, '--additional-properties', 'hideGenerationTimestamp=true', '-o', finalOutDir];
    const taskId = `task-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
    const logFile = path.join(TASKS_DIR, `${taskId}.log`);
    const envWithJavaOpts = Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8' });

    const task = {
      id: taskId,
      projectId: '11',
      status: 'pending',
      cmd: `java ${args.map(a => (a.indexOf(' ')>=0? '"'+a+'"': a)).join(' ')}`,
      openapiUrl: null,
      outDir: finalOutDir,
      logFile,
      createTime: Date.now(),
      endTime: null
    };
    writeJson(taskFile, task);

    fs.appendFileSync(logFile, `Command: java ${args.map(a => (a.indexOf(' ')>=0? '"'+a+'"': a)).join(' ')}\n`);
    fs.appendFileSync(logFile, `Start Time: ${new Date().toISOString()}\n`);

    const child = child_process.spawn('java', args, { cwd: process.cwd(), env: envWithJavaOpts });
    task.pid = child.pid; task.status = 'running'; writeJson(taskFile, task);
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    if (child.stdout && typeof child.stdout.pipe === 'function') child.stdout.pipe(logStream, { end: false });
    if (child.stderr && typeof child.stderr.pipe === 'function') child.stderr.pipe(logStream, { end: false });

    child.on('exit', (code, signal) => {
      try { fs.appendFileSync(logFile, `Exit event: code=${code} signal=${signal}\n`); } catch (e) {}
      task.status = code === 0 ? 'success' : 'failed';
      task.endTime = Date.now();
      try { task.lastLogSnippet = readLastBytes(logFile, 64*1024); } catch (e) { task.lastLogSnippet = ''; }
      try { writeJson(taskFile, task); } catch (e) {}
      try { logStream.end(); } catch (e) {}
      console.log('task finished', task.id, task.status);
    });

    child.on('error', err => {
      try { fs.appendFileSync(logFile, `Spawn error: ${err && err.message}\n`); } catch (e) {}
      task.status = 'failed'; task.endTime = Date.now();
      task.lastError = err && err.message; try { task.lastLogSnippet = readLastBytes(logFile, 64*1024); } catch (e) { task.lastLogSnippet=''; }
      try { writeJson(taskFile, task); } catch (e) {}
      try { logStream.end(); } catch (e) {}
      console.error('spawn error', err);
    });

    console.log('created', taskId, 'pid', child.pid, 'log', logFile, 'taskFile', taskFile);
  } catch (e) {
    console.error('simulate task error', e);
  }
})();
