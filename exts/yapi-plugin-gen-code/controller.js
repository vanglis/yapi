const baseController = require('controllers/base.js');
const interfaceModel = require('models/interface.js');
const projectModel = require('models/project.js');
const yapi = require('yapi.js');
const jsYaml = require('js-yaml');
const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');
const net = require('net');
const archiver = require('archiver');

// 插件存储路径
const PLUGIN_DIR = path.join(process.cwd(), 'exts', 'yapi-plugin-gen-code');
const TASKS_DIR = path.join(PLUGIN_DIR, 'tasks');
const CONFIG_FILE = path.join(PLUGIN_DIR, 'config.json');

// 确保目录存在
try { fs.mkdirSync(TASKS_DIR, { recursive: true }); } catch (e) {}

// 协调在 'running' 状态下遗留的任务（例如服务器重启导致）
try {
  function pidExists(pid) {
    try {
      if (!pid) return false;
  // 使用 process.kill(pid, 0) 跨平台检查进程是否存在
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function reconcileTasks() {
    try {
      const files = fs.readdirSync(TASKS_DIR || '.');
      files.forEach(fn => {
        try {
          if (!fn.endsWith('.json')) return;
          const file = path.join(TASKS_DIR, fn);
          const obj = readJson(file);
          if (!obj) return;
          if (obj.status === 'running') {
            const pid = obj.pid;
        // 如果 pid 仍然存在则保持不变；否则根据输出文件将其标记为 failed 或 success
            if (!pidExists(pid)) {
              // 检查输出目录以判断是否成功
              let marked = 'failed';
              try {
                if (obj.outDir && fs.existsSync(path.join(obj.outDir, '.openapi-generator', 'FILES'))) {
                  marked = 'success';
                }
              } catch (e) {}
              obj.status = marked;
              obj.endTime = Date.now();
              try { obj.lastLogSnippet = readLastBytes(obj.logFile, 64 * 1024); } catch (e) { obj.lastLogSnippet = ''; }
              try { writeJson(file, obj); } catch (e) {}
              try { yapi && yapi.commons && yapi.commons.log && yapi.commons.log(`[gen-code] reconciled task ${obj.id} -> ${obj.status}`); } catch (e) {}
            }
          }
        } catch (e) {}
      });
    } catch (e) {}
  }

  reconcileTasks();
} catch (e) {}

// 全局安全：捕获此插件进程的未捕获异常/未处理的 Promise 拒绝并持久化到文件
try {
  const EXC_LOG = path.join(TASKS_DIR, `last-exception.log`);
  process.on && process.on('uncaughtException', err => {
    try { fs.appendFileSync(EXC_LOG, `uncaughtException: ${new Date().toISOString()}\n${err && err.stack ? err.stack : String(err)}\n\n`); } catch (e) {}
    try { yapi && yapi.commons && yapi.commons.log && yapi.commons.log('gen-code uncaughtException: ' + (err && err.message)); } catch (e) {}
  });
    process.on && process.on('unhandledRejection', (reason, p) => {
      try {
        let rtxt = '';
        try {
          if (reason && reason.stack) rtxt = reason.stack;
          else rtxt = String(reason);
        } catch (ee) { rtxt = String(reason); }
        fs.appendFileSync(EXC_LOG, `unhandledRejection: ${new Date().toISOString()}\nreason=${rtxt}\npromise=${String(p)}\n\n`);
      } catch (e) {}
      try { yapi && yapi.commons && yapi.commons.log && yapi.commons.log('gen-code unhandledRejection: ' + (reason && (reason.message || String(reason)))); } catch (e) {}
    });
  // 记录优雅关闭信号，便于在发生连接被拒绝时做关联排查
    // 当收到终止信号时，先记录日志，再尝试优雅停止子进程并退出。
    function tryKillPid(pid) {
      try {
        if (!pid) return false;
        if (process.platform === 'win32') {
          // Windows: 使用 taskkill 尝试强制结束进程及其子进程
          try {
            child_process.spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']);
            return true;
          } catch (e) {
            return false;
          }
        } else {
          try {
            process.kill(pid, 'SIGTERM');
            return true;
          } catch (e) {
            try { process.kill(pid, 'SIGKILL'); } catch (ee) {}
            return false;
          }
        }
      } catch (e) {
        return false;
      }
    }

    async function gracefulShutdown(signal) {
      try { fs.appendFileSync(EXC_LOG, `${signal} received: ${new Date().toISOString()}\n`); } catch (e) {}
      try { yapi && yapi.commons && yapi.commons.log && yapi.commons.log(`gen-code ${signal} received`); } catch (e) {}

      // 尝试停止在 tasks 目录中仍记录为 running 的子进程
      try {
        const files = fs.readdirSync(TASKS_DIR || '.');
        for (const fn of files) {
          try {
            if (!fn.endsWith('.json')) continue;
            const file = path.join(TASKS_DIR, fn);
            const obj = readJson(file);
            if (!obj) continue;
            if (obj.status === 'running' && obj.pid) {
              try {
                tryKillPid(obj.pid);
                try { fs.appendFileSync(EXC_LOG, `killed task pid ${obj.pid} from ${fn}\n`); } catch (e) {}
              } catch (e) {}
            }
          } catch (e) {}
        }
      } catch (e) {}

      // 给系统一点时间处理 SIGTERM 后再退出
      try {
        setTimeout(() => {
          try { fs.appendFileSync(EXC_LOG, `exiting process due to ${signal} at ${new Date().toISOString()}\n\n`); } catch (e) {}
          try { process.exit(0); } catch (e) { /* fallback */ }
        }, 400);
      } catch (e) {
        try { process.exit(0); } catch (err) {}
      }
    }

    process.on && process.on('SIGINT', () => { gracefulShutdown('SIGINT'); });
    process.on && process.on('SIGTERM', () => { gracefulShutdown('SIGTERM'); });
} catch (e) {}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function readJson(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    return null;
  }
}

// 递归移除对象/树中的 $schema 属性
function removeDollarSchema(obj) {
  if (!obj || (typeof obj !== 'object')) return;
  if (Array.isArray(obj)) {
    obj.forEach(item => removeDollarSchema(item));
    return;
  }
  Object.keys(obj).forEach(key => {
    if (key === '$schema') {
      try { delete obj[key]; } catch (e) {}
      return;
    }
    try { removeDollarSchema(obj[key]); } catch (e) {}
  });
}

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
  } catch (e) {
    return '';
  }
}

// 使用 node-archiver 为目录创建 zip（跨平台）。
// 返回一个 Promise：成功时 resolve 为 destZip 路径，失败时 resolve 为 null。
function createZipArchive(sourceDir, destZip, logFile) {
  return new Promise((resolve) => {
    try {
      try { fs.mkdirSync(path.dirname(destZip), { recursive: true }); } catch (e) {}
      const output = fs.createWriteStream(destZip);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => {
        try { fs.appendFileSync(logFile, `archiver: ${archive.pointer()} total bytes written\n`); } catch (e) {}
        resolve(destZip);
      });

      output.on('end', () => {
  // 流已排空
      });

      archive.on('warning', err => {
        try { fs.appendFileSync(logFile, `archiver warning: ${err && err.message}\n`); } catch (e) {}
      });

      archive.on('error', err => {
        try { fs.appendFileSync(logFile, `archiver error: ${err && err.message}\n`); } catch (e) {}
        try { output.end(); } catch (e) {}
        resolve(null);
      });

      archive.pipe(output);
  // 递归添加目录内容
      archive.directory(sourceDir, false);
      archive.finalize();
    } catch (e) {
      try { fs.appendFileSync(logFile, `createZipArchive exception: ${e && e.message}\n`); } catch (ee) {}
      resolve(null);
    }
  });
}

class genCodeController extends baseController {
  constructor(ctx) {
    super(ctx);
    this.interModel = yapi.getInst(interfaceModel);
    this.projectModel = yapi.getInst(projectModel);
  }

  // 根据 scope 收集接口
  async collectInterfaces(projectId, scope, selectedInterfaces, tag) {
    let list = [];
    if (scope === 'all') {
      list = await this.interModel.listByPid(projectId);
    } else if (scope === 'partial') {
      if (!Array.isArray(selectedInterfaces)) selectedInterfaces = [];
      for (let id of selectedInterfaces) {
        let api = await this.interModel.get(id);
        if (api) list.push(api);
      }
    } else if (scope === 'tag') {
  // 通过 tag 查找
      let all = await this.interModel.listByPid(projectId);
      list = all.filter(item => Array.isArray(item.tag) && item.tag.indexOf(tag) !== -1);
    }
    return list;
  }

  // 将 YApi 接口列表转换为最小化的 OpenAPI 3.0 对象
  buildOpenApi(project, list) {
    const openapi = {
      openapi: '3.0.0',
      info: {
        title: project.name || 'yapi project',
        version: project.version || '1.0.0',
        description: project.desc || ''
      },
      servers: [
        {
          url: project.basepath || '/' 
        }
      ],
      paths: {},
      components: {
        schemas: {}
      }
    };

  // 去重 schemas 的辅助函数
  const schemaMap = {}; // jsonString -> 名称
    const nameCount = {};

    function makeSchemaName(base) {
      const b = base.replace(/[^a-zA-Z0-9_]/g, '_');
      if (!nameCount[b]) nameCount[b] = 0;
      nameCount[b]++;
      return nameCount[b] === 1 ? b : `${b}_${nameCount[b]}`;
    }

    function storeSchema(schemaObj, suggested) {
      try {
        const key = JSON.stringify(schemaObj);
        if (schemaMap[key]) return schemaMap[key];
        const name = makeSchemaName(suggested || 'Schema');
        openapi.components.schemas[name] = schemaObj;
        schemaMap[key] = name;
        return name;
      } catch (e) {
        return null;
      }
    }

    list.forEach(api => {
      try {
        const method = (api.method || 'get').toLowerCase();
  // 确保路径以 '/' 开头
        let p = api.path || api.query_path && api.query_path.path || '/';
        if (!p.startsWith('/')) p = '/' + p;
        if (!openapi.paths[p]) openapi.paths[p] = {};

        const op = {
          summary: api.title || '',
          description: api.desc || api.markdown || '',
          tags: [],
          parameters: [],
          responses: {
            '200': {
              description: 'Successful response'
            }
          }
        };

  // 标签
        if (Array.isArray(api.tag)) op.tags = api.tag;

  // 路径参数
        if (Array.isArray(api.req_params)) {
          api.req_params.forEach(pv => {
            op.parameters.push({
              name: pv.name,
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: pv.desc || ''
            });
          });
        }

        // query params
        if (Array.isArray(api.req_query)) {
          api.req_query.forEach(q => {
            op.parameters.push({
              name: q.name,
              in: 'query',
              required: q.required === '1',
              schema: { type: 'string' },
              description: q.desc || ''
            });
          });
        }

        // headers
        if (Array.isArray(api.req_headers)) {
          api.req_headers.forEach(h => {
            op.parameters.push({
              name: h.name,
              in: 'header',
              required: h.required === '1',
              schema: { type: 'string' },
              description: h.desc || ''
            });
          });
        }

        // requestBody for json or raw
        if (api.req_body_type === 'json' || api.req_body_type === 'raw') {
          let schema = { type: 'object' };
          // if request body is json-schema
          if (api.req_body_is_json_schema && api.req_body_other) {
            try {
              const obj = JSON.parse(api.req_body_other);
              schema = obj;
            } catch (e) {
              // ignore
            }
          }
          // store as component schema and reference it
          let refSchema = schema;
          try {
            const sName = storeSchema(schema, `${method}_${p}_Request`);
            if (sName) refSchema = { $ref: `#/components/schemas/${sName}` };
          } catch (e) {}
          op.requestBody = {
            content: {
              'application/json': {
                schema: refSchema
              }
            }
          };
        } else if (api.req_body_type === 'form' && Array.isArray(api.req_body_form)) {
          const properties = {};
          const required = [];
          api.req_body_form.forEach(f => {
            properties[f.name] = { type: 'string', description: f.desc || '' };
            if (f.required === '1') required.push(f.name);
          });
          op.requestBody = {
            content: {
              'application/x-www-form-urlencoded': {
                schema: {
                  type: 'object',
                  properties,
                  ...(required.length ? { required } : {})
                }
              }
            }
          };
        }

        // responses: try to set example if res_body present
        if (api.res_body_type === 'json' && api.res_body) {
          try {
            const parsed = JSON.parse(api.res_body);
            // attempt to infer schema from example
            let schema = { type: 'object' };
            if (typeof parsed === 'object') {
              // use parsed as example and register a schema component inferred as example wrapper
              schema = { type: 'object' };
              // create a simple example-based schema by using example as example field and a generic schema; store as component
              const sName = storeSchema({ example: parsed }, `${method}_${p}_Response`);
              if (sName) {
                op.responses['200'].content = {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${sName}` },
                    example: parsed
                  }
                };
              } else {
                op.responses['200'].content = {
                  'application/json': {
                    schema,
                    example: parsed
                  }
                };
              }
            } else {
              op.responses['200'].content = {
                'application/json': {
                  schema,
                  example: parsed
                }
              };
            }
          } catch (e) {
            // ignore
          }
        }

        openapi.paths[p][method] = op;
      } catch (e) {
        // continue
      }
    });

    return openapi;
  }

  async generateCode (ctx) {
    const body = ctx.request.body || {};
    const projectId = body.projectId || ctx.request.query.projectId;
    const scope = body.scope || 'all';
    const language = body.language || 'java';
    const template = body.template || 'default';
    const selectedInterfaces = body.selectedInterfaces || [];
    const tag = body.tag || '';
    const projectName = body.projectName || ''; // 用户输入的项目名称，用于多模块命名
    const multiModule = body.multiModule === true;

    // 添加诊断日志：只记录必要的、已脱敏的信息，避免打印整个请求体或敏感字段。
    try {
      const cfgLog = readJson(CONFIG_FILE) || {};
      const verbose = !!cfgLog.verboseLogging;
      const reqHost = (ctx.request && ctx.request.header && ctx.request.header.host) || '';
      const remoteAddrRaw = (ctx.req && ctx.req.socket && (ctx.req.socket.remoteAddress)) || ctx.ip || (ctx.request && ctx.request.ip) || '';

      // 简单脱敏 IP 地址（将最后一段替换为 x 或 截断 IPv6）
      function maskIp(ip) {
        try {
          if (!ip) return '';
          let v = String(ip);
          // strip IPv4-mapped IPv6 prefix
          if (v.startsWith('::ffff:')) v = v.replace('::ffff:', '');
          // IPv4
          const ipv4 = v.match(/^(\d+\.\d+\.\d+)\.(\d+)$/);
          if (ipv4) return `${ipv4[1]}.x`;
          // IPv6: keep first two hextets
          const parts = v.split(':').filter(Boolean);
          if (parts.length > 2) return parts.slice(0, 2).join(':') + ':...';
          return v;
        } catch (e) { return '';} 
      }

      const maskedIp = maskIp(remoteAddrRaw);

      // 构建简化的 body 摘要，避免记录大字段或敏感字段
      const safeSummary = {
        language: body.language || null,
        template: body.template || null,
        scope: body.scope || null,
        selectedInterfacesCount: Array.isArray(body.selectedInterfaces) ? body.selectedInterfaces.length : 0
      };
      // 若开启 verboseLogging，则在摘要中包含部分 selectedInterfaces（前 10 个 id）
      if (verbose && Array.isArray(body.selectedInterfaces) && body.selectedInterfaces.length > 0) {
        safeSummary.selectedInterfacesSample = body.selectedInterfaces.slice(0, 10);
      }

      yapi && yapi.commons && yapi.commons.log && yapi.commons.log(
        `[gen-code] generate called projectId=${projectId} host=${reqHost} origin=${(ctx.origin||'')} ip=${maskedIp} bodySummary=${JSON.stringify(safeSummary)}`
      );
    } catch (e) {
      // ignore logging errors
    }

    if (!projectId) {
      ctx.body = yapi.commons.resReturn(null, 400, 'projectId is required');
      return;
    }

    try {
      const project = await this.projectModel.get(projectId);
      if (!project) {
        ctx.body = yapi.commons.resReturn(null, 404, 'project not found');
        return;
      }

      const list = await this.collectInterfaces(projectId, scope, selectedInterfaces, tag);
      if (!list || list.length === 0) {
        ctx.body = yapi.commons.resReturn(null, 400, 'no interfaces found for selected scope');
        return;
      }

  // build openapi and write JSON file into static attachment so it can be previewed via URL
  const openapiObj = this.buildOpenApi(project, list);
  // remove $schema attributes that may come from json-schema examples to avoid validate errors
  try { removeDollarSchema(openapiObj); } catch (e) {}
  const jsonStr = JSON.stringify(openapiObj, null, 2);

  const attachDir = path.join(yapi.WEBROOT, 'static', 'attachment', `gen-code-${projectId}`);
  try { fs.mkdirSync(attachDir, { recursive: true }); } catch (e) {}
  const filename = path.join(attachDir, `openapi-${Date.now()}.json`);
  fs.writeFileSync(filename, jsonStr, 'utf8');

  // construct publicly accessible URL for the JSON file
  // 优先使用请求头的 host（ctx.request.header.host），fallback 到 ctx.origin，再 fallback 到默认值
  const relPath = path.relative(path.join(yapi.WEBROOT, 'static'), filename).replace(/\\/g, '/');
  // 优先使用请求头的 host（如果存在），fallback 到 ctx.origin，再兜底到本地地址
  let originHost = (ctx.request && ctx.request.header && ctx.request.header.host)
    ? `${(ctx.request.protocol || 'http')}://${ctx.request.header.host}`
    : (ctx.origin || null);
  if (!originHost) {
    // 最后兜底（通常本地开发常用）
    originHost = 'http://127.0.0.1:3000';
  }
  originHost = String(originHost).replace(/\/$/, '');
  const openapiUrl = `${originHost}/${relPath}`;

      // build command pieces and defaults from config file
  const cfg = readJson(CONFIG_FILE) || {};
  // prefer explicit configured paths; otherwise resolve modules relative to repository root
  // use __dirname (plugin folder) to compute repo root reliably instead of depending on process.cwd()
  const repoRoot = path.resolve(__dirname, '..', '..');
  const jarPath = body.jarPath || cfg.jarPath || path.join(repoRoot, 'modules', 'openapi-generator-cli', 'target', 'openapi-generator-cli.jar');
  // determine outDir: prefer explicit outDir, then cfg, otherwise use fixed 'data' under project root if requested
  const outDir = body.output_path ? path.join(process.cwd(), body.output_path) : (body.outDir || cfg.outDir || path.join(process.cwd(), 'data'));
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}

      const additionalProps = body.additionalProperties || cfg.additionalProperties || 'hideGenerationTimestamp=true';
      
      // 添加业务层包配置
      const businessPackage = 'com.cnnp.dip.business';
      const apiPackage = 'com.cnnp.dip.api';
      const presentPackage = 'com.cnnp.dip.present';
      
      // 增强additionalProperties，加入包路径参数
      const enhancedProps = `${additionalProps},businessPackage=${businessPackage},apiPackage=${apiPackage},presentPackage=${presentPackage},controllerPackage=${presentPackage}`;
      
      const templatePath = (body.templatePath || cfg.templatePath) || path.join(repoRoot, 'modules', 'openapi-generator', 'src', 'main', 'resources', 'Java');

      // build args to use the local JSON file as the -i parameter (more reliable than HTTP fetch)
    // compute per-api output dir name based on openapi filename (without .json)
        const apiName = path.basename(filename, '.json');
        const finalOutDir = path.join(outDir, apiName);
        try { fs.mkdirSync(finalOutDir, { recursive: true }); } catch (e) {}
        // args order: -jar <jar> generate -i <url> -g <lang> -t <templatePath> --additional-properties <props> -o <outDir>
  // ensure java prints UTF-8 to avoid garbled logs on Windows; we'll pass via JAVA_TOOL_OPTIONS env var

      // Use local filename instead of HTTP URL to avoid network access issues from child process
      let args = ['-jar', jarPath, 'generate', '-i', filename, '-g', language, '-t', templatePath, '--additional-properties', enhancedProps, '-o', finalOutDir];

      // support skip validate flag
      if (body.skipValidate === true || body.skip_validate === true) {
        args.push('--skip-validate-spec');
      }

      // if template custom override
      if (template && template !== 'default' && (body.templatePath || cfg.templatePath)) {
        const tpath = body.templatePath || cfg.templatePath;
        // replace -t value
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-t' && i + 1 < args.length) {
            args[i + 1] = tpath;
            break;
          }
        }
      }

      // Create a task record
      const taskId = `task-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
      const logFile = path.join(TASKS_DIR, `${taskId}.log`);
      // ensure java prints UTF-8 to avoid garbled logs on Windows; we'll pass via JAVA_TOOL_OPTIONS env var
      const fileEncodingValue = (body.fileEncoding || cfg.fileEncoding) || '-Dfile.encoding=UTF-8';
      const envWithJavaOpts = Object.assign({}, process.env, { JAVA_TOOL_OPTIONS: fileEncodingValue });

      const task = {
        id: taskId,
        projectId,
        status: 'pending',
        cmd: `java ${args.map(a => (a.indexOf(' ') >= 0 ? '"' + a + '"' : a)).join(' ')}`,
        openapiUrl,
        outDir: finalOutDir,
        logFile,
        createTime: Date.now(),
        endTime: null
      };
      writeJson(taskFile, task);

      // Spawn java to run openapi-generator. We set cwd to the jar's directory so
      // relative resolution and resource access are stable even if Node was started
      // from a different working directory.
      try {
        try { fs.appendFileSync(logFile, `Command: java ${args.map(a => (a.indexOf(' ') >= 0 ? '"' + a + '"' : a)).join(' ')}\n`); } catch (e) {}
        try { fs.appendFileSync(logFile, `Start Time: ${new Date().toISOString()}\n`); } catch (e) {}

        // basic diagnostics before spawn
        try {
          const ver = child_process.spawnSync('java', ['-version'], { encoding: 'utf8', env: envWithJavaOpts });
          if (ver.stderr) try { fs.appendFileSync(logFile, `java -version stderr:\n${ver.stderr}\n`); } catch (e) {}
          if (ver.stdout) try { fs.appendFileSync(logFile, `java -version stdout:\n${ver.stdout}\n`); } catch (e) {}
        } catch (e) {}
        try { fs.appendFileSync(logFile, `jarPath: ${jarPath} exists=${fs.existsSync(jarPath)}\n`); } catch (e) {}

        const jarCwd = path.dirname(jarPath) || process.cwd();
        try { fs.appendFileSync(logFile, `spawn cwd: ${process.cwd()} jarCwd: ${jarCwd}\n`); } catch (e) {}

        // spawn java and pipe output to log
        let child = null;
        try {
          child = child_process.spawn('java', args, { cwd: jarCwd, env: envWithJavaOpts, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (spawnErr) {
          try { fs.appendFileSync(logFile, `spawn error: ${spawnErr && spawnErr.message}\n`); } catch (e) {}
          task.status = 'failed';
          task.endTime = Date.now();
          try { task.lastError = spawnErr && (spawnErr.message || String(spawnErr)); } catch (e) {}
          try { task.lastLogSnippet = readLastBytes(logFile, 64 * 1024); } catch (e) { task.lastLogSnippet = ''; }
          try { writeJson(taskFile, task); } catch (e) {}
          child = null;
        }

        if (child) {
          try { fs.appendFileSync(logFile, `Spawned pid: ${child.pid}\n`); } catch (e) {}
          task.pid = child.pid;
          task.status = 'running';
          try { writeJson(taskFile, task); } catch (e) {}

          const logStream = fs.createWriteStream(logFile, { flags: 'a' });
          if (child.stdout && child.stdout.pipe) child.stdout.pipe(logStream, { end: false });
          if (child.stderr && child.stderr.pipe) child.stderr.pipe(logStream, { end: false });

          child.on('error', err => {
            try { fs.appendFileSync(logFile, `Spawn error: ${err && err.message}\n`); } catch (e) {}
            task.status = 'failed';
            task.endTime = Date.now();
            try { task.lastError = err && (err.message || String(err)); } catch (e) {}
            try { task.lastLogSnippet = readLastBytes(logFile, 64 * 1024); } catch (e) { task.lastLogSnippet = ''; }
            try { writeJson(taskFile, task); } catch (e) {}
            try { logStream && logStream.end && logStream.end(); } catch (e) {}
          });

          // record exit but finalize on 'close' when stdio streams are finished/flushed
          let _exitCode = null;
          let _exitSignal = null;
          child.on('exit', (code, signal) => {
            _exitCode = code;
            _exitSignal = signal;
            try { fs.appendFileSync(logFile, `Exit event: code=${code} signal=${signal}\n`); } catch (e) {}
          });

          child.on('close', (code, signal) => {
            // prefer exit code captured by 'exit' listener; fallback to close args
            const finalCode = (_exitCode !== null ? _exitCode : code);
            const finalSignal = (_exitSignal !== null ? _exitSignal : signal);
            try { fs.appendFileSync(logFile, `Close event: code=${finalCode} signal=${finalSignal}\n`); } catch (e) {}

            // decide status: success if exit code 0 OR output dir contains .openapi-generator/FILES
            let decidedSuccess = false;
            try {
              if (finalCode === 0) decidedSuccess = true;
            } catch (e) {}
            try {
              if (!decidedSuccess && finalOutDir && fs.existsSync(path.join(finalOutDir, '.openapi-generator', 'FILES'))) {
                decidedSuccess = true;
              }
            } catch (e) {}

            task.status = decidedSuccess ? 'success' : 'failed';
            task.endTime = Date.now();

            try {
              if (decidedSuccess) {
                try { fs.appendFileSync(logFile, `Generation SUCCESS. Output directory: ${finalOutDir}\n`); } catch (e) {}
                  // ========== 多模块重构（boot + business + present + api）开始 ==========
                  if (multiModule === true) {
                    try { fs.appendFileSync(logFile, `[multi-module] assembling multi-module structure...\n`); } catch (e) {}
                    try {
                      const baseName = projectName || path.basename(finalOutDir);
                      const mmRoot = path.join(path.dirname(finalOutDir), `${baseName}-multi`);
                      try { fs.mkdirSync(mmRoot, { recursive: true }); } catch (e) {}
                      const moduleSuffixes = ['boot','business','present','api'];
                      const moduleDirBySuffix = moduleSuffixes.reduce((acc, suffix) => {
                        acc[suffix] = `${baseName}-${suffix}`;
                        return acc;
                      }, {});
                      Object.values(moduleDirBySuffix).forEach(dirName => {
                        try { fs.mkdirSync(path.join(mmRoot, dirName, 'src', 'main', 'java'), { recursive: true }); } catch (e) {}
                        try { fs.mkdirSync(path.join(mmRoot, dirName, 'src', 'main', 'resources'), { recursive: true }); } catch (e) {}
                      });

                      // 移动已有代码：接口与模型到 api；控制器到 present
                      const javaSrc = path.join(finalOutDir, 'src', 'main', 'java');
                      const movePackage = (pkgRel, targetModule) => {
                        try {
                          const pkgPath = path.join(javaSrc, ...pkgRel.split('.'));
                          if (fs.existsSync(pkgPath)) {
                            const dest = path.join(mmRoot, targetModule, 'src', 'main', 'java', ...pkgRel.split('.'));
                            try { fs.mkdirSync(dest, { recursive: true }); } catch (e) {}
                            // 简单复制再删除，保持目录结构
                            const copyRecursive = (src, dst) => {
                              const st = fs.statSync(src);
                              if (st.isDirectory()) {
                                try { fs.mkdirSync(dst, { recursive: true }); } catch (e) {}
                                fs.readdirSync(src).forEach(child => copyRecursive(path.join(src, child), path.join(dst, child)));
                              } else {
                                fs.copyFileSync(src, dst);
                              }
                            };
                            copyRecursive(pkgPath, dest);
                          }
                        } catch (e) {
                          try { fs.appendFileSync(logFile, `[multi-module] movePackage ${pkgRel} error: ${e.message}\n`); } catch (ee) {}
                        }
                      };
                      movePackage('com.cnnp.dip.api', moduleDirBySuffix.api);
                      movePackage('com.cnnp.dip.api.model', moduleDirBySuffix.api);
                      movePackage('com.cnnp.dip.present', moduleDirBySuffix.present);
                      movePackage('com.cnnp.dip.boot', moduleDirBySuffix.boot);
                      movePackage('com.cnnp.dip.boot.config', moduleDirBySuffix.boot);
                      // 移动业务层代码到business模块
                      movePackage('com.cnnp.dip.business', moduleDirBySuffix.business);
                      movePackage('com.cnnp.dip.business.impl', moduleDirBySuffix.business);
                      movePackage('com.cnnp.dip.business.manager', moduleDirBySuffix.business);
                      movePackage('com.cnnp.dip.business.repository', moduleDirBySuffix.business);

                      // 注意：原有的 business 占位类生成逻辑已移除
                      // 现在业务层代码（Service/ServiceImpl/Manager/Repository）由 OpenAPI Generator 模板自动生成

                      // 生成 boot Application 类
                      try {
                        const bootBase = path.join(mmRoot, moduleDirBySuffix.boot, 'src', 'main', 'java', 'com', 'cnnp', 'dip', 'boot');
                        try { fs.mkdirSync(bootBase, { recursive: true }); } catch (e) {}
                        const appFile = path.join(bootBase, 'DipApplication.java');
                        if (!fs.existsSync(appFile)) {
                          fs.writeFileSync(appFile, `package com.cnnp.dip.boot;\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n/**\n * 多模块启动入口 (boot 模块)。\n * 组件扫描根包: com.cnnp.dip\n */\n@SpringBootApplication(scanBasePackages = \"com.cnnp.dip\")\npublic class DipApplication {\n    public static void main(String[] args) {\n        SpringApplication.run(DipApplication.class, args);\n    }\n}\n`, 'utf8');
                        }
                      } catch (e) {}

                      // 生成 POM 文件
                      const writePom = (file, content) => { try { fs.writeFileSync(file, content, 'utf8'); } catch (e) {} };
                      const parentPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.cnnp.dip</groupId>\n  <artifactId>${baseName}-parent</artifactId>\n  <version>1.0.0</version>\n  <packaging>pom</packaging>\n  <modules>\n    <module>boot</module>\n    <module>business</module>\n    <module>present</module>\n    <module>api</module>\n  </modules>\n  <properties>\n    <java.version>17</java.version>\n    <spring.boot.version>3.2.0</spring.boot.version>\n  </properties>\n  <dependencyManagement>\n    <dependencies>\n      <dependency>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-dependencies</artifactId>\n        <version>${'$'}{spring.boot.version}</version>\n        <type>pom</type>\n        <scope>import</scope>\n      </dependency>\n    </dependencies>\n  </dependencyManagement>\n</project>\n`;
                      writePom(path.join(mmRoot, 'pom.xml'), parentPom);

                      const apiPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${baseName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${baseName}-api</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.projectlombok</groupId>\n      <artifactId>lombok</artifactId>\n      <optional>true</optional>\n    </dependency>\n  </dependencies>\n</project>\n`;
                      writePom(path.join(mmRoot, 'api', 'pom.xml'), apiPom);

                      const presentPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${baseName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${baseName}-present</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${baseName}-api</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${baseName}-business</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.projectlombok</groupId>\n      <artifactId>lombok</artifactId>\n      <optional>true</optional>\n    </dependency>\n  </dependencies>\n</project>\n`;
                      writePom(path.join(mmRoot, 'present', 'pom.xml'), presentPom);

                      const businessPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${baseName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${baseName}-business</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${baseName}-api</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.projectlombok</groupId>\n      <artifactId>lombok</artifactId>\n      <optional>true</optional>\n    </dependency>\n    <!-- 持久层框架依赖（可选，按需启用） -->\n    <!-- MyBatis支持 -->\n    <!--\n    <dependency>\n      <groupId>org.mybatis.spring.boot</groupId>\n      <artifactId>mybatis-spring-boot-starter</artifactId>\n      <version>3.0.2</version>\n    </dependency>\n    -->\n    <!-- Spring Data JPA支持 -->\n    <!--\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-data-jpa</artifactId>\n    </dependency>\n    -->\n    <!-- 数据库驱动（按实际需要选择） -->\n    <!--\n    <dependency>\n      <groupId>com.mysql</groupId>\n      <artifactId>mysql-connector-j</artifactId>\n      <scope>runtime</scope>\n    </dependency>\n    -->\n  </dependencies>\n</project>\n`;
                      writePom(path.join(mmRoot, 'business', 'pom.xml'), businessPom);

                      const bootPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${baseName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${baseName}-boot</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${baseName}-present</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${baseName}-business</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n  </dependencies>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-maven-plugin</artifactId>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n`;
                      writePom(path.join(mmRoot, 'boot', 'pom.xml'), bootPom);

                      // 标记任务输出切换到多模块根目录
                      task.outDir = mmRoot;
                      task.multiModule = true;
                      try { fs.appendFileSync(logFile, `[multi-module] assembled at ${mmRoot}\n`); } catch (e) {}
                      try { writeJson(taskFile, task); } catch (e) {}
                    } catch (e) {
                      try { fs.appendFileSync(logFile, `[multi-module] exception: ${e && e.message}\n`); } catch (ee) {}
                    }
                  }
                  // ========== 多模块重构结束 ==========
                // optional: package generated code into a jar and upload to maven repo if configured
                try {
                  const cfg2 = readJson(CONFIG_FILE) || {};
                  if (cfg2.packageOnSuccess) {
                    try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: packaging enabled, starting...\n`); } catch (e) {}
                    // helper: recursively find first .jar file under the output dir
                    function findJar(dir, depth = 3) {
                      try {
                        if (depth < 0) return null;
                        const items = fs.readdirSync(dir);
                        for (let it of items) {
                          const p = path.join(dir, it);
                          try {
                            const st = fs.statSync(p);
                            if (st.isFile() && p.endsWith('.jar')) return p;
                            if (st.isDirectory()) {
                              const found = findJar(p, depth - 1);
                              if (found) return found;
                            }
                          } catch (e) {}
                        }
                      } catch (e) {}
                      return null;
                    }

                    // optional: try to build the project if configured or pom/gradle detected
                    try {
                      const buildTool = cfg2.buildTool || (fs.existsSync(path.join(finalOutDir, 'pom.xml')) ? 'maven' : (fs.existsSync(path.join(finalOutDir, 'build.gradle')) ? 'gradle' : null));
                      if (buildTool === 'maven') {
                        try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: detected maven project, running mvn -DskipTests package\n`); } catch (e) {}
                        const mvpack = child_process.spawnSync('mvn', ['-DskipTests', 'package'], { cwd: finalOutDir, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
                        if (mvpack.stdout) try { fs.appendFileSync(logFile, `mvn package stdout:\n${mvpack.stdout}\n`); } catch (e) {}
                        if (mvpack.stderr) try { fs.appendFileSync(logFile, `mvn package stderr:\n${mvpack.stderr}\n`); } catch (e) {}
                      } else if (buildTool === 'gradle') {
                        try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: detected gradle project, running gradle assemble\n`); } catch (e) {}
                        const gradcmd = fs.existsSync(path.join(finalOutDir, 'gradlew.bat')) ? path.join(finalOutDir, 'gradlew.bat') : 'gradle';
                        const gp = child_process.spawnSync(gradcmd, ['assemble'], { cwd: finalOutDir, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
                        if (gp.stdout) try { fs.appendFileSync(logFile, `gradle stdout:\n${gp.stdout}\n`); } catch (e) {}
                        if (gp.stderr) try { fs.appendFileSync(logFile, `gradle stderr:\n${gp.stderr}\n`); } catch (e) {}
                      }
                    } catch (e) {}

                    // try common build paths first
                    let jarPath = null;
                    try {
                      // maven default target
                      const targetDir = path.join(finalOutDir, 'target');
                      if (fs.existsSync(targetDir)) jarPath = findJar(targetDir, 2);
                    } catch (e) {}
                    try {
                      // gradle default
                      if (!jarPath) {
                        const gradleDir = path.join(finalOutDir, 'build', 'libs');
                        if (fs.existsSync(gradleDir)) jarPath = findJar(gradleDir, 2);
                      }
                    } catch (e) {}
                    // fallback: search finalOutDir shallow
                    if (!jarPath) jarPath = findJar(finalOutDir, 3);

                    if (!jarPath) {
                      try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: no jar artifact found under ${finalOutDir}, skipping upload\n`); } catch (e) {}
                    } else {
                      try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: found jar ${jarPath}\n`); } catch (e) {}
                      // determine coordinates
                      const groupId = cfg2.groupId || cfg2.mavenGroupId;
                      const artifactId = cfg2.artifactId || cfg2.mavenArtifactId;
                      const version = cfg2.version || cfg2.mavenVersion || (new Date().toISOString().replace(/[^0-9]/g, ''));
                      const repoUrl = cfg2.repoUrl || cfg2.mavenRepoUrl;
                      const repoId = cfg2.repoId || cfg2.mavenRepoId || 'gen-code-repo';

                      if (!groupId || !artifactId || !version || !repoUrl) {
                        try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: missing coordinates or repo config (groupId/artifactId/version/repoUrl). Skipping upload.\n`); } catch (e) {}
                      } else {
                        // run mvn deploy:deploy-file
                        try {
                          const mvnArgs = ['deploy:deploy-file', `-DgroupId=${groupId}`, `-DartifactId=${artifactId}`, `-Dversion=${version}`, `-Dpackaging=jar`, `-Dfile=${jarPath}`, `-DrepositoryId=${repoId}`, `-Durl=${repoUrl}`, '-DgeneratePom=false'];
                          // add credentials via settings.xml? support simple -Dusername/-Dpassword
                          if (cfg2.repoUsername) mvnArgs.push(`-Dusername=${cfg2.repoUsername}`);
                          if (cfg2.repoPassword) mvnArgs.push(`-Dpassword=${cfg2.repoPassword}`);
                          try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: running mvn ${mvnArgs.join(' ')}\n`); } catch (e) {}
                          const mv = child_process.spawnSync('mvn', mvnArgs, { cwd: finalOutDir, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
                          if (mv.stdout) try { fs.appendFileSync(logFile, `mvn stdout:\n${mv.stdout}\n`); } catch (e) {}
                          if (mv.stderr) try { fs.appendFileSync(logFile, `mvn stderr:\n${mv.stderr}\n`); } catch (e) {}
                          if (mv.status === 0) {
                            try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: upload succeeded to ${repoUrl}\n`); } catch (e) {}
                          } else {
                            try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: upload failed (exit ${mv.status})\n`); } catch (e) {}
                          }
                        } catch (e) {
                          try { fs.appendFileSync(logFile, `[gen-code] packagingAndUpload: exception running mvn: ${e && e.message}\n`); } catch (ee) {}
                        }
                      }
                    }
                  }
                } catch (e) {}
              } else {
                try { fs.appendFileSync(logFile, `Generation FAILED. See above logs for details.\n`); } catch (e) {}
                // fallback delayed re-check: if failed now, wait briefly and check for output files
                try {
                  setTimeout(() => {
                    try {
                      if (finalOutDir && fs.existsSync(path.join(finalOutDir, '.openapi-generator', 'FILES'))) {
                        // correct previous decision
                        task.status = 'success';
                        task.endTime = Date.now();
                        try { fs.appendFileSync(logFile, `Delayed check: found output files -> marking success\n`); } catch (e) {}
                        try { task.lastLogSnippet = readLastBytes(logFile, 64 * 1024); } catch (e) { task.lastLogSnippet = ''; }
                        try { writeJson(taskFile, task); } catch (e) {}
                      }
                    } catch (e) {}
                  }, 1500);
                } catch (e) {}
              }
            } catch (e) {}

            try { task.lastLogSnippet = readLastBytes(logFile, 64 * 1024); } catch (e) { task.lastLogSnippet = ''; }
            try { writeJson(taskFile, task); } catch (e) {}
            try { logStream && logStream.end && logStream.end(); } catch (e) {}
            // attempt to create downloadable zip (versioned) and expose URL in task; use archiver (async)
            try {
              const attachDir = path.join(yapi.WEBROOT, 'static', 'attachment', `gen-code-${projectId}`);
              try { fs.mkdirSync(attachDir, { recursive: true }); } catch (e) {}
              // use timestamped archive name for history management
              const toZipDir = (task && task.outDir) ? task.outDir : finalOutDir;
              const zipName = `${path.basename(toZipDir)}-${Date.now()}.zip`;
              const zipPath = path.join(attachDir, zipName);
              createZipArchive(toZipDir, zipPath, logFile).then(created => {
                try {
                  if (created) {
                    try { fs.appendFileSync(logFile, `Archive created at ${zipPath}\n`); } catch (e) {}
                    // compute public URL
                    try {
                      const rel = path.relative(path.join(yapi.WEBROOT, 'static'), zipPath).replace(/\\/g, '/');
                      const host = originHost || 'http://127.0.0.1:3000';
                      const url = `${host}/${rel}`;
                      task.downloadUrl = url;
                      task.downloadName = zipName;
                      try { writeJson(taskFile, task); } catch (e) {}
                    } catch (e) {}

                    // history retention: keep only N recent archives for this project
                    try {
                      const cfg3 = readJson(CONFIG_FILE) || {};
                      const retention = (typeof cfg3.archiveRetention === 'number' && cfg3.archiveRetention >= 0) ? cfg3.archiveRetention : 20;
                      if (retention >= 0) {
                        const files = fs.readdirSync(attachDir).filter(f => f.toLowerCase().endsWith('.zip'))
                          .map(f => ({ name: f, full: path.join(attachDir, f), mtime: fs.statSync(path.join(attachDir, f)).mtime.getTime() }))
                          .sort((a, b) => b.mtime - a.mtime);
                        if (files.length > retention) {
                          const toDelete = files.slice(retention);
                          toDelete.forEach(td => {
                            try { fs.unlinkSync(td.full); try { fs.appendFileSync(logFile, `Removed old archive ${td.full}\n`); } catch (e) {} } catch (e) {}
                          });
                        }
                      }
                    } catch (e) {}
                  }
                } catch (e) {}
              }).catch(() => {});
            } catch (e) {}
          });
        }
      } catch (err) {
        try { fs.appendFileSync(logFile, `\n[gen-code error] ${err && err.message}\n`); } catch (e) {}
        task.status = 'failed';
        task.endTime = Date.now();
        try { task.lastError = err && (err.message || String(err)); } catch (e) {}
        try { task.lastLogSnippet = readLastBytes(logFile, 64 * 1024); } catch (e) { task.lastLogSnippet = ''; }
        try { writeJson(taskFile, task); } catch (e) {}
      }

  // return task id and openapi url immediately
  // 注意：返回的 outDir 应为最终生成目录 finalOutDir
  ctx.body = yapi.commons.resReturn({ taskId, outDir: finalOutDir, openapiUrl }, 0, 'task created');
    } catch (err) {
      yapi.commons.log(err, 'error');
      ctx.body = yapi.commons.resReturn(null, 500, err.message || 'internal error');
    }
  }

  // GET task status and logs (supports offset/length for pagination)
  async getTask(ctx) {
    try {
      const taskId = ctx.request.query.taskId;
      let offset = parseInt(ctx.request.query.offset || '0', 10);
      const length = parseInt(ctx.request.query.length || '65536', 10); // default 64KB
      if (!taskId) return (ctx.body = yapi.commons.resReturn(null, 400, 'taskId is required'));
      const taskFile = path.join(TASKS_DIR, `${taskId}.json`);
      let task = readJson(taskFile);
      let taskReadError = false;
      if (!task) {
        // try to recover from partial write or read raw file to extract minimal info
        try {
          const raw = fs.readFileSync(taskFile, 'utf8');
          try {
            task = JSON.parse(raw);
          } catch (e) {
            // partial/corrupt JSON; attempt to extract pid from raw content or log
            taskReadError = true;
            let pid = null;
            const pidJsonMatch = raw.match(/"pid"\s*:\s*(\d+)/);
            if (pidJsonMatch) pid = Number(pidJsonMatch[1]);
            else {
              const pidLogMatch = raw.match(/Spawned pid:\s*(\d+)/);
              if (pidLogMatch) pid = Number(pidLogMatch[1]);
            }
            task = {
              id: taskId,
              projectId: null,
              status: pid ? 'running' : 'pending',
              pid: pid,
              cmd: null,
              openapiUrl: null,
              outDir: null,
              logFile: path.join(TASKS_DIR, `${taskId}.log`),
              createTime: null,
              endTime: null
            };
          }
        } catch (e) {
          // task file missing/unreadable: synthesize a minimal running task pointing to log
          taskReadError = true;
          task = {
            id: taskId,
            projectId: null,
            status: 'running',
            pid: null,
            cmd: null,
            openapiUrl: null,
            outDir: null,
            logFile: path.join(TASKS_DIR, `${taskId}.log`),
            createTime: null,
            endTime: null
          };
        }
      }

      // If task was previously marked running, verify PID still exists. If not, try to reconcile.
      try {
        if (task.status === 'running') {
          // if we have a pid, check whether the process is still alive
          if (task.pid && typeof pidExists === 'function') {
            if (!pidExists(task.pid)) {
              // pid gone: infer final status by checking for generator marker in outDir
              try {
                if (task.outDir && fs.existsSync(path.join(task.outDir, '.openapi-generator', 'FILES'))) {
                  task.status = 'success';
                } else {
                  task.status = 'failed';
                }
              } catch (e) {
                task.status = 'failed';
              }
              task.endTime = task.endTime || Date.now();
              try { writeJson(taskFile, task); } catch (e) {}
            }
          } else if (!task.pid) {
            // no pid recorded but status running -> treat as running and leave as-is (transient write)
          }
        }
      } catch (e) {
        // swallow PID-check errors to avoid crashing the polling endpoint
      }

      const logFile = task.logFile;
      let log = '';
      let newOffset = offset;
      try {
        if (fs.existsSync(logFile)) {
          const stats = fs.statSync(logFile);
          if (offset < 0) offset = 0;
          const start = offset;
          const end = Math.min(start + length, stats.size);
          if (start < end) {
            const buf = Buffer.alloc(end - start);
            const fd = fs.openSync(logFile, 'r');
            fs.readSync(fd, buf, 0, end - start, start);
            fs.closeSync(fd);
            log = buf.toString();
            newOffset = end;
          }
        }
      } catch (e) {
        // don't let log read errors break the API; return empty log
        log = '';
        newOffset = offset;
      }

      // compute a lightweight processAlive flag for convenience
      let processAlive = false;
      try {
        if (task && task.pid && typeof pidExists === 'function') processAlive = !!pidExists(task.pid);
      } catch (e) { processAlive = false; }

      // build a short human-readable status message for frontend display
      let statusMessage = '';
      try {
        if (!task) {
          statusMessage = 'task not found';
        } else if (task.status === 'running') {
          if (processAlive) {
            statusMessage = `Process is running (pid ${task.pid || 'unknown'})`;
          } else if (task.pid) {
            statusMessage = `Process appears to have exited; checking output directory...`;
          } else {
            statusMessage = 'Process is running (pid unknown)';
          }
        } else if (task.status === 'success') {
          statusMessage = 'Generation completed successfully';
        } else if (task.status === 'failed') {
          statusMessage = 'Generation failed — check logs for details';
        } else {
          statusMessage = `Status: ${task.status}`;
        }
        if (taskReadError) statusMessage += ' (note: task metadata read error; showing best-effort info)';
      } catch (e) {
        statusMessage = 'status unknown';
      }

      // check whether local server at 127.0.0.1:3000 is accepting connections
      let serverAlive = false;
      try {
        serverAlive = await new Promise(resolve => {
          const sock = net.createConnection({ host: '127.0.0.1', port: 3000 }, () => {
            try { sock.end(); } catch (e) {}
            resolve(true);
          });
          sock.on('error', () => { resolve(false); });
          sock.setTimeout(500, () => { try { sock.destroy(); } catch (e) {} ; resolve(false); });
        });
      } catch (e) { serverAlive = false; }

      ctx.body = yapi.commons.resReturn({ task, log, offset: newOffset, processAlive, statusMessage, serverAlive }, 0, 'ok');
    } catch (err) {
      // top-level safeguard: always return a valid response instead of crashing/closing connection
      try { yapi && yapi.commons && yapi.commons.log && yapi.commons.log('[gen-code] getTask error: ' + (err && err.message)); } catch (e) {}
      ctx.body = yapi.commons.resReturn({ task: null, log: '', offset: 0 }, 0, 'ok');
    }
  }

  // list generated archives under static/attachment/gen-code-*
  async getArchives(ctx) {
    try {
      const base = path.join(yapi.WEBROOT, 'static', 'attachment');
      const dirs = [];
      try {
        const items = fs.readdirSync(base);
        items.forEach(it => {
          if (it.startsWith('gen-code-')) {
            const d = path.join(base, it);
            if (fs.existsSync(d) && fs.statSync(d).isDirectory()) dirs.push(d);
          }
        });
      } catch (e) {}
      const results = [];
      dirs.forEach(d => {
        try {
          const files = fs.readdirSync(d);
          files.forEach(f => {
            if (f.toLowerCase().endsWith('.zip')) {
              try {
                const full = path.join(d, f);
                const rel = path.relative(path.join(yapi.WEBROOT, 'static'), full).replace(/\\/g, '/');
                results.push({ name: f, url: `/${rel}`, path: full, mtime: fs.statSync(full).mtime.getTime() });
              } catch (e) {}
            }
          });
        } catch (e) {}
      });
      // sort by mtime desc
      results.sort((a, b) => b.mtime - a.mtime);
      ctx.body = yapi.commons.resReturn({ archives: results }, 0, 'ok');
    } catch (e) {
      ctx.body = yapi.commons.resReturn({ archives: [] }, 0, 'ok');
    }
  }

  // simple config read/write using file under plugin folder
  async getConfig(ctx) {
    const cfg = readJson(CONFIG_FILE) || {};
    ctx.body = yapi.commons.resReturn({ config: cfg }, 0, 'ok');
  }

  async setConfig(ctx) {
    const body = ctx.request.body || {};
    const cfg = readJson(CONFIG_FILE) || {};
    const allowed = ['jarPath', 'templatePath', 'outDir', 'additionalProperties'];
    allowed.forEach(k => {
      if (typeof body[k] !== 'undefined') cfg[k] = body[k];
    });
    try {
      writeJson(CONFIG_FILE, cfg);
      ctx.body = yapi.commons.resReturn({ config: cfg }, 0, 'ok');
    } catch (e) {
      ctx.body = yapi.commons.resReturn(null, 500, e.message || 'write config error');
    }
  }
}

module.exports = genCodeController;
