(function(global) {
  if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.defaults.plugins.datalabels = { display: false };
  }

  function resolveChartContext(target) {
    if (!target) return null;
    if (typeof target.getContext === 'function') return target.getContext('2d');
    return target;
  }

  function destroyChart(chart) {
    if (chart && typeof chart.destroy === 'function') {
      chart.destroy();
    }
    return null;
  }

  function replaceChart(chart, target, config) {
    var ctx = resolveChartContext(target);
    if (!ctx || typeof Chart === 'undefined') {
      return destroyChart(chart);
    }
    destroyChart(chart);
    return new Chart(ctx, config);
  }

  function chartTickNumber(value) {
    return Math.round(Number(value) || 0).toLocaleString('es-CL');
  }

  function chartTickKilos(value) {
    return chartTickNumber(value) + ' kg';
  }

  global.destroyChart = destroyChart;
  global.replaceChart = replaceChart;
  global.chartTickNumber = chartTickNumber;
  global.chartTickKilos = chartTickKilos;
  global.ArmaHubCharts = {
    destroyChart: destroyChart,
    replaceChart: replaceChart,
    chartTickNumber: chartTickNumber,
    chartTickKilos: chartTickKilos
  };
})(window);