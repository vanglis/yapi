#!/usr/bin/env node
/**
 * Assemble a multi-module Maven project (boot + business + present + api)
 * from an existing OpenAPI-Generator Spring output folder.
 *
 * Usage (PowerShell):
 *   node .\exts\yapi-plugin-gen-code\tools\assemble-multimodule.js \
 *     --source "D:\\path\\to\\single-module-output" \
 *     --apiPackage com.cnnp.dip.api \
 *     --presentPackage com.cnnp.dip.present \
 *     --modelPackage com.cnnp.dip.api.model \
 *     --bootPackages com.cnnp.dip.boot,com.cnnp.dip.boot.config
 *
 * Result: creates sibling folder <source>-multi containing parent pom and submodules.
 */

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.replace(/^--/, '').split('=');
      if (typeof v !== 'undefined') args[k] = v;
      else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { args[k] = argv[++i]; }
      else args[k] = true;
    }
  }
  return args;
}

function mkdirp(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (e) {} }

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    mkdirp(dst);
    fs.readdirSync(src).forEach(ch => copyRecursive(path.join(src, ch), path.join(dst, ch)));
  } else {
    mkdirp(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function movePackage(javaSrc, pkg, moduleRoot, log) {
  if (!pkg) return;
  const rel = pkg.split('.');
  const pkgPath = path.join(javaSrc, ...rel);
  if (fs.existsSync(pkgPath)) {
    const dest = path.join(moduleRoot, 'src', 'main', 'java', ...rel);
    copyRecursive(pkgPath, dest);
    log.push(`moved ${pkg} -> ${dest}`);
  }
}

function writeFile(file, content) {
  mkdirp(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
}

function main() {
  const args = parseArgs(process.argv);
  const source = args.source || args.s;
  const apiPackage = args.apiPackage || 'com.cnnp.dip.api';
  const presentPackage = args.presentPackage || 'com.cnnp.dip.present';
  const modelPackage = args.modelPackage || 'com.cnnp.dip.api.model';
  const bootPackages = (args.bootPackages || 'com.cnnp.dip.boot,com.cnnp.dip.boot.config')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!source) {
    console.error('[assemble-multimodule] --source is required');
    process.exit(2);
  }
  const javaSrc = path.join(source, 'src', 'main', 'java');
  if (!fs.existsSync(javaSrc)) {
    console.error(`[assemble-multimodule] invalid source, not found: ${javaSrc}`);
    process.exit(3);
  }

  const parentName = path.basename(source);
  const mmRoot = path.join(path.dirname(source), `${parentName}-multi`);
  mkdirp(mmRoot);

  const modules = ['boot','business','present','api'];
  modules.forEach(m => {
    mkdirp(path.join(mmRoot, m, 'src', 'main', 'java'));
    mkdirp(path.join(mmRoot, m, 'src', 'main', 'resources'));
  });

  const log = [];
  // move api, model, present, boot packages
  movePackage(javaSrc, apiPackage, path.join(mmRoot, 'api'), log);
  movePackage(javaSrc, modelPackage, path.join(mmRoot, 'api'), log);
  movePackage(javaSrc, presentPackage, path.join(mmRoot, 'present'), log);
  bootPackages.forEach(pkg => movePackage(javaSrc, pkg, path.join(mmRoot, 'boot'), log));

  // business placeholder
  const bizBase = path.join(mmRoot, 'business', 'src', 'main', 'java', 'com', 'cnnp', 'dip', 'business');
  mkdirp(bizBase);
  const placeholder = path.join(bizBase, 'GeneralService.java');
  if (!fs.existsSync(placeholder)) {
    writeFile(placeholder, `package com.cnnp.dip.business;\n\n/**\n * 自动生成的业务服务占位类: General\n */\npublic class GeneralService {\n}\n`);
  }

  // boot Application
  const bootBase = path.join(mmRoot, 'boot', 'src', 'main', 'java', 'com', 'cnnp', 'dip', 'boot');
  mkdirp(bootBase);
  const appFile = path.join(bootBase, 'DipApplication.java');
  if (!fs.existsSync(appFile)) {
    writeFile(appFile, `package com.cnnp.dip.boot;\n\nimport org.springframework.boot.SpringApplication;\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n/**\n * 多模块启动入口 (boot 模块)。\n * 组件扫描根包: com.cnnp.dip\n */\n@SpringBootApplication(scanBasePackages = \"com.cnnp.dip\")\npublic class DipApplication {\n    public static void main(String[] args) {\n        SpringApplication.run(DipApplication.class, args);\n    }\n}\n`);
  }

  // POMs
  const parentPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <groupId>com.cnnp.dip</groupId>\n  <artifactId>${parentName}-parent</artifactId>\n  <version>1.0.0</version>\n  <packaging>pom</packaging>\n  <modules>\n    <module>boot</module>\n    <module>business</module>\n    <module>present</module>\n    <module>api</module>\n  </modules>\n  <properties>\n    <java.version>17</java.version>\n    <spring.boot.version>3.2.0</spring.boot.version>\n  </properties>\n  <dependencyManagement>\n    <dependencies>\n      <dependency>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-dependencies</artifactId>\n        <version>${'$'}{spring.boot.version}</version>\n        <type>pom</type>\n        <scope>import</scope>\n      </dependency>\n    </dependencies>\n  </dependencyManagement>\n</project>\n`;
  writeFile(path.join(mmRoot, 'pom.xml'), parentPom);

  const apiPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${parentName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${parentName}-api</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n    <dependency>\n      <groupId>org.projectlombok</groupId>\n      <artifactId>lombok</artifactId>\n      <optional>true</optional>\n    </dependency>\n  </dependencies>\n</project>\n`;
  writeFile(path.join(mmRoot, 'api', 'pom.xml'), apiPom);

  const presentPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${parentName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${parentName}-present</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${parentName}-api</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n  </dependencies>\n</project>\n`;
  writeFile(path.join(mmRoot, 'present', 'pom.xml'), presentPom);

  const businessPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${parentName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${parentName}-business</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${parentName}-api</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n  </dependencies>\n</project>\n`;
  writeFile(path.join(mmRoot, 'business', 'pom.xml'), businessPom);

  const bootPom = `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<project xmlns=\"http://maven.apache.org/POM/4.0.0\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n         xsi:schemaLocation=\"http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd\">\n  <modelVersion>4.0.0</modelVersion>\n  <parent>\n    <groupId>com.cnnp.dip</groupId>\n    <artifactId>${parentName}-parent</artifactId>\n    <version>1.0.0</version>\n  </parent>\n  <artifactId>${parentName}-boot</artifactId>\n  <dependencies>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${parentName}-present</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>com.cnnp.dip</groupId>\n      <artifactId>${parentName}-business</artifactId>\n      <version>1.0.0</version>\n    </dependency>\n    <dependency>\n      <groupId>org.springframework.boot</groupId>\n      <artifactId>spring-boot-starter-web</artifactId>\n    </dependency>\n  </dependencies>\n  <build>\n    <plugins>\n      <plugin>\n        <groupId>org.springframework.boot</groupId>\n        <artifactId>spring-boot-maven-plugin</artifactId>\n      </plugin>\n    </plugins>\n  </build>\n</project>\n`;
  writeFile(path.join(mmRoot, 'boot', 'pom.xml'), bootPom);

  console.log(`[assemble-multimodule] done: ${mmRoot}`);
  if (log.length) {
    console.log(log.map(s => ` - ${s}`).join('\n'));
  }
}

try { main(); } catch (e) { console.error('[assemble-multimodule] error:', e && e.message); process.exit(1); }
