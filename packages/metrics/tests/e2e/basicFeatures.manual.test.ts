/**
 * Test metrics standard functions
 *
 * @group e2e/metrics/standardFunctions
 */
import {
  invokeFunction,
  TestStack,
} from '@aws-lambda-powertools/testing-utils';
import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
} from '@aws-sdk/client-cloudwatch';
import { join } from 'node:path';
import { getMetrics } from '../helpers/metricsUtils';
import { MetricsTestNodejsFunction } from '../helpers/resources';
import {
  commonEnvironmentVars,
  ONE_MINUTE,
  RESOURCE_NAME_PREFIX,
  SETUP_TIMEOUT,
  TEARDOWN_TIMEOUT,
  TEST_CASE_TIMEOUT,
} from './constants';

describe(`Metrics E2E tests, manual usage`, () => {
  const testStack = new TestStack({
    stackNameProps: {
      stackNamePrefix: RESOURCE_NAME_PREFIX,
      testName: 'BasicFeatures-Manual',
    },
  });

  // Location of the lambda function code
  const lambdaFunctionCodeFilePath = join(
    __dirname,
    'basicFeatures.manual.test.functionCode.ts'
  );
  const startTime = new Date();

  const expectedServiceName = 'e2eManual';
  new MetricsTestNodejsFunction(
    testStack,
    {
      entry: lambdaFunctionCodeFilePath,
      environment: {
        EXPECTED_SERVICE_NAME: expectedServiceName,
      },
    },
    {
      nameSuffix: 'Manual',
    }
  );

  const cloudwatchClient = new CloudWatchClient({});
  const invocations = 2;

  beforeAll(async () => {
    // Deploy the stack
    await testStack.deploy();

    // Get the actual function names from the stack outputs
    const functionName = testStack.findAndGetStackOutputValue('Manual');

    // Act
    await invokeFunction({
      functionName,
      times: invocations,
      invocationMode: 'SEQUENTIAL',
    });
  }, SETUP_TIMEOUT);

  describe('ColdStart metrics', () => {
    it(
      'should capture ColdStart Metric',
      async () => {
        const { EXPECTED_NAMESPACE: expectedNamespace } = commonEnvironmentVars;

        // Check coldstart metric dimensions
        const coldStartMetrics = await getMetrics(
          cloudwatchClient,
          expectedNamespace,
          'ColdStart',
          1
        );
        expect(coldStartMetrics.Metrics?.length).toBe(1);
        const coldStartMetric = coldStartMetrics.Metrics?.[0];
        expect(coldStartMetric?.Dimensions).toStrictEqual([
          { Name: 'service', Value: expectedServiceName },
        ]);

        // Check coldstart metric value
        const adjustedStartTime = new Date(startTime.getTime() - 60 * 1000);
        const endTime = new Date(new Date().getTime() + 60 * 1000);
        console.log(
          `Manual command: aws cloudwatch get-metric-statistics --namespace ${expectedNamespace} --metric-name ColdStart --start-time ${Math.floor(
            adjustedStartTime.getTime() / 1000
          )} --end-time ${Math.floor(
            endTime.getTime() / 1000
          )} --statistics 'Sum' --period 60 --dimensions '${JSON.stringify([
            { Name: 'service', Value: expectedServiceName },
          ])}'`
        );
        const coldStartMetricStat = await cloudwatchClient.send(
          new GetMetricStatisticsCommand({
            Namespace: expectedNamespace,
            StartTime: adjustedStartTime,
            Dimensions: [{ Name: 'service', Value: expectedServiceName }],
            EndTime: endTime,
            Period: 60,
            MetricName: 'ColdStart',
            Statistics: ['Sum'],
          })
        );

        // Despite lambda has been called twice, coldstart metric sum should only be 1
        const singleDataPoint = coldStartMetricStat.Datapoints
          ? coldStartMetricStat.Datapoints[0]
          : {};
        expect(singleDataPoint?.Sum).toBe(1);
      },
      TEST_CASE_TIMEOUT
    );
  });

  describe('Default and extra dimensions', () => {
    it(
      'should produce a Metric with the default and extra one dimensions',
      async () => {
        const {
          EXPECTED_NAMESPACE: expectedNamespace,
          EXPECTED_METRIC_NAME: expectedMetricName,
          EXPECTED_METRIC_VALUE: expectedMetricValue,
          EXPECTED_DEFAULT_DIMENSIONS: expectedDefaultDimensions,
          EXPECTED_EXTRA_DIMENSION: expectedExtraDimension,
        } = commonEnvironmentVars;

        // Check metric dimensions
        const metrics = await getMetrics(
          cloudwatchClient,
          expectedNamespace,
          expectedMetricName,
          1
        );

        expect(metrics.Metrics?.length).toBe(1);
        const metric = metrics.Metrics?.[0];
        const expectedDimensions = [
          { Name: 'service', Value: expectedServiceName },
          {
            Name: Object.keys(expectedDefaultDimensions)[0],
            Value: expectedDefaultDimensions.MyDimension,
          },
          {
            Name: Object.keys(expectedExtraDimension)[0],
            Value: expectedExtraDimension.MyExtraDimension,
          },
        ];
        expect(metric?.Dimensions).toStrictEqual(expectedDimensions);

        // Check coldstart metric value
        const adjustedStartTime = new Date(
          startTime.getTime() - 3 * ONE_MINUTE
        );
        const endTime = new Date(new Date().getTime() + ONE_MINUTE);
        console.log(
          `Manual command: aws cloudwatch get-metric-statistics --namespace ${expectedNamespace} --metric-name ${expectedMetricName} --start-time ${Math.floor(
            adjustedStartTime.getTime() / 1000
          )} --end-time ${Math.floor(
            endTime.getTime() / 1000
          )} --statistics 'Sum' --period 60 --dimensions '${JSON.stringify(
            expectedDimensions
          )}'`
        );
        const metricStat = await cloudwatchClient.send(
          new GetMetricStatisticsCommand({
            Namespace: expectedNamespace,
            StartTime: adjustedStartTime,
            Dimensions: expectedDimensions,
            EndTime: endTime,
            Period: 60,
            MetricName: expectedMetricName,
            Statistics: ['Sum'],
          })
        );

        // Since lambda has been called twice in this test and potentially more in others, metric sum should be at least of expectedMetricValue * invocationCount
        const singleDataPoint = metricStat.Datapoints
          ? metricStat.Datapoints[0]
          : {};
        expect(singleDataPoint.Sum).toBeGreaterThanOrEqual(
          parseInt(expectedMetricValue) * invocations
        );
      },
      TEST_CASE_TIMEOUT
    );
  });

  afterAll(async () => {
    if (!process.env.DISABLE_TEARDOWN) {
      await testStack.destroy();
    }
  }, TEARDOWN_TIMEOUT);
});
