const child_process = require('child_process');
const args = ['-jar', 'D:\\yapii\\yapii\\modules\\openapi-generator-cli\\target\\openapi-generator-cli.jar', 'generate', '-i', 'D:\\yapii\\yapii\\static\\attachment\\gen-code-11\\openapi-1762392791249.json', '-g', 'java', '-t', 'D:\\yapii\\yapii\\modules\\openapi-generator\\src\\main\\resources\\Java', '--additional-properties', 'hideGenerationTimestamp=true', '-o', 'D:\\yapii\\yapii\\data\\openapi-1762392791249'];
console.log('Spawning java with args', args);
const child = child_process.spawn('java', args, { env: Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: '-Dfile.encoding=UTF-8' }) });
console.log('pid', child.pid);
child.stdout.on('data', d=> process.stdout.write('[STDOUT] '+d));
child.stderr.on('data', d=> process.stderr.write('[STDERR] '+d));
child.on('exit', (code, sig)=> console.log('exit', code, sig));
child.on('error', e=> console.error('err', e));
