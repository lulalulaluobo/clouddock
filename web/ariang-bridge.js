/* Loaded after the NAS AriaNg bundle and before Angular bootstrap. */
(() => {
  const endpoint = location.origin + "/api/clouddock/rpc";
  angular.module("ariaNg").config(["$provide", "$httpProvider", "localStorageServiceProvider", "ariaNgDefaultOptions", function ($provide, $httpProvider, storage, defaults) {
    storage.setPrefix("CloudDock.AriaNg");
    Object.assign(defaults, { rpcAlias: "CloudDock", rpcHost: location.hostname, rpcPort: location.port || (location.protocol === "https:" ? "443" : "80"), rpcInterface: "api/clouddock/rpc", protocol: location.protocol.slice(0, -1), httpMethod: "POST", secret: "", language: "zh_Hans", theme: localStorage.getItem("theme") === "dark" ? "dark" : "light" });
    $provide.decorator("ariaNgSettingService", ["$delegate", function (service) {
      service.getCurrentRpcUrl = () => endpoint;
      service.getCurrentRpcHttpMethod = () => "POST";
      service.getCurrentRpcSecret = () => "";
      service.getCurrentRpcDisplayName = () => "CloudDock";
      service.isCurrentRpcUseWebSocket = () => false;
      service.setLanguage("zh_Hans");
      service.setTheme(defaults.theme);
      return service;
    }]);
    $httpProvider.interceptors.push(["$q", function ($q) {
      return {
        request(config) {
          if (config.url === endpoint) {
            config.method = "POST";
            config.headers = { ...config.headers, Authorization: "Bearer " + (localStorage.getItem("token") || "") };
          }
          return config;
        },
        responseError(response) {
          if (response.config?.url === endpoint && (response.status === 401 || (response.status === 403 && response.data?.success === false))) parent.postMessage({ type: "clouddock-auth-required" }, location.origin);
          return $q.reject(response);
        },
      };
    }]);
  }]);
})();
