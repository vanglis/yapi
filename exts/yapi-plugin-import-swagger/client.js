import { message } from 'antd';
// 注意：原来的实现从同目录引入了服务端运行逻辑 `run.js`，该文件依赖 server-only 模块
//（例如 swagger-client、fs 等），会被前端打包器尝试解析并导致构建失败。
// 为避免在前端打包时引入服务端代码，这里不直接引用 `run.js`，而在客户端提示由服务端处理。

module.exports = function() {
  this.bindHook('import_data', function(importDataModule) {
    if (!importDataModule || typeof importDataModule !== 'object') {
      console.error('importDataModule 参数Must be Object Type');
      return null;
    }
    importDataModule.swagger = {
      name: 'Swagger',
      run: async function(/* res */) {
        // 该功能依赖服务端解析（使用 swagger-client 等 node-only 模块），
        // 前端仅提供 UI 钩子；如需导入，请使用服务器端导入接口或在服务器上运行命令行工具。
        message.error('该插件的解析逻辑只能在服务端运行，客户端暂不支持直接解析 Swagger 文件。');
        return null;
      },
      desc: `<p>Swagger数据导入（ 支持 v2.0+ ）</p>
      <p>
        <a target="_blank" href="https://hellosean1025.github.io/yapi/documents/data.html#通过命令行导入接口数据">通过命令行导入接口数据</a>
      </p>
      `
    };
  });
};
