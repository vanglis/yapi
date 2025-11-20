const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const yapi = require('../yapi.js');

class GenerateCodeController {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * 生成代码
   */
  async generate() {
    const { language, template, scope, selectedInterfaces } = this.ctx.request.body;
    
    try {
      // 1. 将所选接口组装成 OpenAPI 3.0 格式的 JSON 文件
      const openApiJson = await this._convertToOpenApi(selectedInterfaces);
      const tempFilePath = path.join(__dirname, 'temp_openapi.json');
      fs.writeFileSync(tempFilePath, JSON.stringify(openApiJson, null, 2));
      
      // 2. 调用 openapi-generator-cli 工具生成代码
      const outputDir = path.join(__dirname, 'generated_code');
      const command = `java -jar modules/openapi-generator-cli/target/openapi-generator-cli.jar generate \
        -i ${tempFilePath} \
        -g ${language} \
        -t modules/openapi-generator/src/main/resources/${language} \
        --additional-properties artifactId=generated-code,hideGenerationTimestamp=true \
        -o ${outputDir}`;
      
      exec(command, (error, stdout, stderr) => {
        if (error) {
          yapi.commons.log(`生成代码失败: ${error.message}`, 'error');
          this.ctx.body = yapi.commons.resReturn(null, 500, '生成代码失败');
          return;
        }
        yapi.commons.log(`生成代码成功: ${stdout}`, 'info');
        this.ctx.body = yapi.commons.resReturn({ outputDir }, 200, '生成代码成功');
      });
    } catch (err) {
      yapi.commons.log(`生成代码异常: ${err.message}`, 'error');
      this.ctx.body = yapi.commons.resReturn(null, 500, '生成代码异常');
    }
  }

  /**
   * 将接口转换为 OpenAPI 3.0 格式
   */
  async _convertToOpenApi(interfaceIds) {
    // TODO: 实现接口转换逻辑
    return {
      openapi: '3.0.0',
      info: {
        title: 'Generated API',
        version: '1.0.0'
      },
      paths: {}
    };
  }
}

module.exports = GenerateCodeController;