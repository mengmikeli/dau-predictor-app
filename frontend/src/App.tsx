import React, { useState, useCallback } from 'react';
import { Layout, Card, Form, Select, Button, InputNumber, Row, Col, Typography, Space, message, Collapse, Checkbox, Slider, Tabs, Switch, ConfigProvider, theme } from 'antd';
import { Line } from 'react-chartjs-2';
import { MoonOutlined, SunOutlined } from '@ant-design/icons';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import axios from 'axios';
import './App.css';

const { Content } = Layout;
const { Title: AntTitle, Text } = Typography;
const { Option } = Select;
const { Panel } = Collapse;
const { TabPane } = Tabs;

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

interface PredictionParams {
  initiativeType: 'acquisition' | 'retention' | 'combined';
  acquisition: {
    weeklyInstalls: number;
    weeksToStart: number;
    duration: number;
  };
  retention: {
    targetUsers: 'new' | 'existing' | 'all';
    monthsToStart: number;
    d1Gain: number;
    d7Gain: number;
    d14Gain: number;
    d28Gain: number;
    d360Gain?: number;
    d720Gain?: number;
  };
  baselineDecay: number;
  segments?: {
    commercial: boolean;
    consumer: boolean;
  };
  platforms?: {
    ios: boolean;
    android: boolean;
  };
  exposureRate?: number;
  customBaseline?: {
    currentDAU: Record<string, number>;
    weeklyAcquisitions: Record<string, number>;
    retentionCurves: {
      existing: Record<string, number>;
      new: Record<string, number>;
    };
  } | null;
}

interface PredictionResult {
  baseline: number[];
  withInitiative: number[];
  incrementalDAU?: number[];
  summary: {
    totalImpact: number;
    peakImpact: number;
    peakMonth: number;
    peakLiftPercent: number;
    breakdown?: {
      existingUsers: number;
      newUsers: number;
      newAcquisition: number;
    };
  };
  retentionCurves?: {
    baseNewUser: any;
    improvedNewUser: any;
    baseExistingUser: any;
    improvedExistingUser: any;
  };
}

function App() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [baselineData, setBaselineData] = useState<any>(null);
  const [editingBaseline, setEditingBaseline] = useState(false);
  const [baselineForm] = Form.useForm();
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('dau-predictor-theme');
    return saved ? saved === 'dark' : false;
  });

  const fetchBaselineData = useCallback(async () => {
    try {
      // Try to load from localStorage first
      const savedData = loadBaselineFromStorage();
      
      const defaultData = {
        currentDAU: {
          commercial_ios: 3550000,
          commercial_android: 2780000,
          consumer_ios: 3180000,
          consumer_android: 8300000
        },
        weeklyAcquisitions: {
          commercial_ios: 317000,
          commercial_android: 334000,
          consumer_ios: 300000,
          consumer_android: 987000
        },
        retentionCurves: {
          existing: { d1: 58, d7: 51.8, d14: 50, d28: 48, d360: 30, d720: 20 },
          new: { d1: 26.4, d7: 17.5, d14: 15, d28: 13, d360: 6, d720: 3 }
        }
      };
      
      const data = savedData || defaultData;
      
      // Calculate totals
      data.totalCurrentDAU = Object.values(data.currentDAU).reduce((sum: number, val: unknown) => sum + (val as number), 0);
      data.totalWeeklyAcquisitions = Object.values(data.weeklyAcquisitions).reduce((sum: number, val: unknown) => sum + (val as number), 0);
      data.dailyAcquisitions = data.totalWeeklyAcquisitions / 7;
      
      setBaselineData(data);
    } catch (error) {
      message.error('Failed to set baseline data');
    }
  }, []);

  React.useEffect(() => {
    fetchBaselineData();
  }, [fetchBaselineData]);

  React.useEffect(() => {
    if (result && typeof window !== 'undefined') {
      // Force chart redraw on mobile devices
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [result]);

  const toggleTheme = () => {
    // Use requestAnimationFrame to ensure smooth transition
    requestAnimationFrame(() => {
      const newTheme = !isDarkMode;
      setIsDarkMode(newTheme);
      localStorage.setItem('dau-predictor-theme', newTheme ? 'dark' : 'light');
    });
  };

  const handleEditBaseline = () => {
    setEditingBaseline(true);
    baselineForm.setFieldsValue(baselineData);
  };

  const handleSaveBaseline = async (values: any) => {
    try {
      // Update baseline data state
      setBaselineData(values);
      setEditingBaseline(false);
      
      // Save to localStorage for persistence
      localStorage.setItem('dau-predictor-baseline', JSON.stringify(values));
      message.success('Baseline data saved successfully');
    } catch (error) {
      message.error('Failed to save baseline data');
    }
  };

  const handleCancelBaseline = () => {
    setEditingBaseline(false);
    baselineForm.resetFields();
  };

  const loadBaselineFromStorage = () => {
    const saved = localStorage.getItem('dau-predictor-baseline');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (error) {
        console.error('Failed to parse saved baseline data');
      }
    }
    return null;
  };

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      const params: PredictionParams = {
        initiativeType: values.initiativeType,
        acquisition: {
          weeklyInstalls: values.weeklyInstalls || 0,
          weeksToStart: values.weeksToStart || 0,
          duration: values.duration || 0,
        },
        retention: {
          targetUsers: values.targetUsers || 'new',
          monthsToStart: values.monthsToStart || 0,
          d1Gain: (values.d1Gain || 0) / 100,
          d7Gain: (values.d7Gain || 0) / 100,
          d14Gain: (values.d14Gain || 0) / 100,
          d28Gain: (values.d28Gain || 0) / 100,
          d360Gain: (values.d360Gain || 0) / 100,
          d720Gain: (values.d720Gain || 0) / 100,
        },
        baselineDecay: (values.baselineDecay || 0) / 100,
        segments: {
          commercial: values.commercial !== false,
          consumer: values.consumer !== false,
        },
        platforms: {
          ios: values.ios !== false,
          android: values.android !== false,
        },
        exposureRate: values.exposureRate || 100,
        customBaseline: baselineData ? {
          currentDAU: baselineData.currentDAU,
          weeklyAcquisitions: baselineData.weeklyAcquisitions,
          retentionCurves: baselineData.retentionCurves
        } : null,
      };

      const response = await axios.post('http://localhost:8000/api/predict', params);
      setResult(response.data);
    } catch (error) {
      message.error('Failed to calculate prediction');
    } finally {
      setLoading(false);
    }
  };

  const getMonthlyData = (dailyData: number[]) => {
    const monthlyData = [];
    for (let month = 0; month < 12; month++) {
      const startDay = month * 30;
      const endDay = Math.min(startDay + 30, dailyData.length);
      const monthlyAvg = dailyData.slice(startDay, endDay).reduce((sum, val) => sum + val, 0) / (endDay - startDay);
      monthlyData.push(monthlyAvg);
    }
    return monthlyData;
  };

  const chartData = result ? {
    labels: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
    datasets: [
      {
        label: 'Baseline DAU',
        data: getMonthlyData(result.baseline),
        borderColor: isDarkMode ? '#8B8B8B' : '#595959',
        backgroundColor: isDarkMode ? 'rgba(139, 139, 139, 0.1)' : 'rgba(89, 89, 89, 0.1)',
        tension: 0.1,
        borderWidth: 2,
      },
      {
        label: 'Baseline + Initiative Impact',
        data: getMonthlyData(result.withInitiative),
        borderColor: isDarkMode ? '#52C41A' : '#389E0D',
        backgroundColor: isDarkMode ? 'rgba(82, 196, 26, 0.1)' : 'rgba(56, 158, 13, 0.1)',
        tension: 0.1,
        borderWidth: 2,
      },
    ],
  } : null;

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    devicePixelRatio: window.devicePixelRatio || 1,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    animation: {
      duration: 0
    },
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          color: isDarkMode ? '#FFFFFF' : '#000000',
          font: {
            family: 'JetBrains Mono, Monaco, Menlo, Consolas, monospace',
            size: 12,
            weight: 500,
          }
        }
      },
      title: {
        display: true,
        text: 'DAU Prediction - 12 Month Forecast',
        color: isDarkMode ? '#FFFFFF' : '#000000',
        font: {
          family: 'JetBrains Mono, Monaco, Menlo, Consolas, monospace',
          size: 14,
          weight: 600,
        }
      },
    },
    scales: {
      x: {
        ticks: {
          color: isDarkMode ? '#FFFFFF' : '#000000',
          font: {
            family: 'JetBrains Mono, Monaco, Menlo, Consolas, monospace',
            size: 11,
            weight: 400,
          }
        },
        grid: {
          color: isDarkMode ? '#333333' : '#E5E5E5',
        }
      },
      y: {
        beginAtZero: false,
        ticks: {
          color: isDarkMode ? '#FFFFFF' : '#000000',
          font: {
            family: 'JetBrains Mono, Monaco, Menlo, Consolas, monospace',
            size: 11,
            weight: 400,
          },
          callback: function(value: any) {
            return (value / 1000000).toFixed(1) + 'M';
          }
        },
        grid: {
          color: isDarkMode ? '#333333' : '#E5E5E5',
        }
      },
    },
  };

  return (
    <ConfigProvider
      theme={{
        algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: isDarkMode ? '#FFFFFF' : '#000000',
          colorBgContainer: isDarkMode ? '#1A1A1A' : '#FFFFFF',
          colorBgElevated: isDarkMode ? '#262626' : '#FFFFFF',
          colorBgLayout: isDarkMode ? '#0A0A0A' : '#F5F5F5',
          colorText: isDarkMode ? '#FFFFFF' : '#000000',
          colorTextSecondary: isDarkMode ? '#8B8B8B' : '#595959',
          colorBorder: isDarkMode ? '#333333' : '#D9D9D9',
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        },
      }}
    >
      <Layout 
        className={isDarkMode ? 'dark-theme' : 'light-theme'}
        style={{ minHeight: '100vh', backgroundColor: isDarkMode ? '#0A0A0A' : '#F5F5F5' }}
      >
        <Layout.Header style={{ 
          backgroundColor: isDarkMode ? '#000000' : '#FFFFFF', 
          borderBottom: `1px solid ${isDarkMode ? '#333333' : '#E5E5E5'}`,
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div className="header-logo-container">
            <img 
              src="/logo.png" 
              alt="DAU Predictor Logo"
              className="app-logo"
            />
            <AntTitle 
              level={2} 
              style={{ 
                color: isDarkMode ? '#FFFFFF' : '#000000', 
                margin: 0,
                transition: 'color 0.2s ease',
                transform: 'translateZ(0)',
                backfaceVisibility: 'hidden',
                fontFamily: 'JetBrains Mono, Monaco, Menlo, Consolas, monospace',
                fontWeight: 600,
                letterSpacing: '0.01em',
                fontSize: '18px'
              }}
            >
              DAU_PREDICTOR
            </AntTitle>
          </div>
          <Space>
            <SunOutlined style={{ color: isDarkMode ? '#8B8B8B' : '#000000' }} />
            <Switch 
              checked={isDarkMode}
              onChange={toggleTheme}
              style={{ backgroundColor: isDarkMode ? '#333333' : '#D9D9D9' }}
            />
            <MoonOutlined style={{ color: isDarkMode ? '#FFFFFF' : '#8B8B8B' }} />
          </Space>
        </Layout.Header>
      <Content style={{ padding: '20px' }}>
        <Tabs defaultActiveKey="1">
          <TabPane tab="DAU Prediction" key="1">
            <Row gutter={24}>
              <Col xs={24} lg={12}>
                <Card title="Growth Initiative Parameters">
              <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                initialValues={{
                  initiativeType: 'acquisition',
                  targetUsers: 'new',
                  baselineDecay: 0.01,
                  weeklyInstalls: 0,
                  weeksToStart: 0,
                  duration: 1,
                  d1Gain: 0,
                  d7Gain: 0,
                  d14Gain: 0,
                  d28Gain: 0,
                  d360Gain: 0,
                  d720Gain: 0,
                  commercial: true,
                  consumer: true,
                  ios: true,
                  android: true,
                  exposureRate: 100,
                }}
              >
                <Form.Item name="initiativeType" label="Initiative Type">
                  <Select>
                    <Option value="acquisition">Acquisition Campaign</Option>
                    <Option value="retention">Retention Experiment</Option>
                    <Option value="combined">Combined</Option>
                  </Select>
                </Form.Item>

                <Form.Item
                  noStyle
                  shouldUpdate={(prevValues, currentValues) =>
                    prevValues.initiativeType !== currentValues.initiativeType
                  }
                >
                  {({ getFieldValue }) => {
                    const type = getFieldValue('initiativeType');
                    return (
                      <>
                        {(type === 'acquisition' || type === 'combined') && (
                          <Card size="small" title="Acquisition Parameters" style={{ marginBottom: 16 }}>
                            <Form.Item name="weeklyInstalls" label="Expected Weekly Installations">
                              <InputNumber style={{ width: '100%' }} min={0} />
                            </Form.Item>
                            <Form.Item name="weeksToStart" label="Lead Time (weeks)">
                              <InputNumber style={{ width: '100%' }} min={0} />
                              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                Time before campaign launches and extra installations begin
                              </div>
                            </Form.Item>
                            <Form.Item name="duration" label="Campaign Duration (weeks)">
                              <InputNumber style={{ width: '100%' }} min={1} />
                              <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
                                How long the extra installations will continue
                              </div>
                            </Form.Item>
                          </Card>
                        )}

                        {(type === 'retention' || type === 'combined') && (
                          <Card size="small" title="Retention Parameters" style={{ marginBottom: 16 }}>
                            <Form.Item name="targetUsers" label="Target Users">
                              <Select>
                                <Option value="new">New Users Only</Option>
                                <Option value="existing">Existing Users Only</Option>
                                <Option value="all">All Users</Option>
                              </Select>
                            </Form.Item>
                            <Form.Item name="monthsToStart" label="Months to Experiment Start">
                              <InputNumber style={{ width: '100%' }} min={0} />
                            </Form.Item>
                            <Row gutter={16}>
                              <Col xs={24} sm={12}>
                                <Form.Item name="d1Gain" label="D1 Retention Gain (%)">
                                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Form.Item name="d7Gain" label="D7 Retention Gain (%)">
                                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Row gutter={16}>
                              <Col xs={24} sm={12}>
                                <Form.Item name="d14Gain" label="D14 Retention Gain (%)">
                                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Form.Item name="d28Gain" label="D28 Retention Gain (%)">
                                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} />
                                </Form.Item>
                              </Col>
                            </Row>
                            <Row gutter={16}>
                              <Col xs={24} sm={12}>
                                <Form.Item name="d360Gain" label="D360 Retention Gain (%)">
                                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="Optional" />
                                </Form.Item>
                              </Col>
                              <Col xs={24} sm={12}>
                                <Form.Item name="d720Gain" label="D720 Retention Gain (%)">
                                  <InputNumber style={{ width: '100%' }} min={0} step={0.1} placeholder="Optional" />
                                </Form.Item>
                              </Col>
                            </Row>
                          </Card>
                        )}
                      </>
                    );
                  }}
                </Form.Item>

                <Collapse ghost>
                  <Panel header="Advanced Settings" key="1">
                    <Card size="small" title="Targeting" style={{ marginBottom: 16 }}>
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Form.Item label="User Segments">
                            <Form.Item name="commercial" valuePropName="checked" noStyle>
                              <Checkbox>Commercial</Checkbox>
                            </Form.Item>
                            <br />
                            <Form.Item name="consumer" valuePropName="checked" noStyle>
                              <Checkbox>Consumer</Checkbox>
                            </Form.Item>
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item label="Platforms">
                            <Form.Item name="ios" valuePropName="checked" noStyle>
                              <Checkbox>iOS</Checkbox>
                            </Form.Item>
                            <br />
                            <Form.Item name="android" valuePropName="checked" noStyle>
                              <Checkbox>Android</Checkbox>
                            </Form.Item>
                          </Form.Item>
                        </Col>
                      </Row>
                      <Form.Item name="exposureRate" label="Exposure Rate (%)">
                        <Slider min={0} max={100} marks={{0: '0%', 50: '50%', 100: '100%'}} />
                      </Form.Item>
                    </Card>
                  </Panel>
                </Collapse>

                <Card size="small" title="Baseline Parameters" style={{ marginBottom: 16 }}>
                  <Form.Item name="baselineDecay" label="Daily DAU Decay Rate (%)">
                    <InputNumber style={{ width: '100%' }} min={0} max={1} step={0.001} />
                  </Form.Item>
                </Card>

                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading} size="large">
                    Calculate DAU Impact
                  </Button>
                </Form.Item>
              </Form>
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            {result && (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Card title="Prediction Results">
                  <div 
                    className="chart-container"
                    style={{ 
                      height: '300px', 
                      position: 'relative',
                      width: '100%',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {chartData && (
                      <Line 
                        key={`chart-${Date.now()}`}
                        data={chartData} 
                        options={chartOptions}
                        width={undefined}
                        height={undefined}
                      />
                    )}
                  </div>
                </Card>

                <Card title="DAU Impact (Delta)">
                  <div 
                    className="chart-container"
                    style={{ 
                      height: '300px', 
                      position: 'relative',
                      width: '100%',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {chartData && result?.incrementalDAU && (
                      <Line 
                        key={`delta-chart-${Date.now()}`}
                        data={{
                          labels: Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`),
                          datasets: [
                            {
                              label: 'DAU Impact',
                              data: getMonthlyData(result.incrementalDAU),
                              borderColor: isDarkMode ? '#52C41A' : '#389E0D',
                              backgroundColor: isDarkMode ? 'rgba(82, 196, 26, 0.1)' : 'rgba(56, 158, 13, 0.1)',
                              tension: 0.1,
                              borderWidth: 2,
                              fill: true,
                            }
                          ]
                        }}
                        options={{
                          ...chartOptions,
                          plugins: {
                            ...chartOptions.plugins,
                            title: {
                              ...chartOptions.plugins.title,
                              text: 'Incremental DAU Impact - 12 Month Forecast'
                            }
                          }
                        }}
                        width={undefined}
                        height={undefined}
                      />
                    )}
                  </div>
                </Card>

                <Card title="Summary Metrics">
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Text strong>Total 12-Month Impact:</Text>
                      <div className="technical-number">{(result.summary.totalImpact / 1000000).toFixed(2)}M DAU-days</div>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Text strong>Peak Impact:</Text>
                      <div className="technical-number">{(result.summary.peakImpact / 1000000).toFixed(2)}M DAU</div>
                    </Col>
                  </Row>
                  <Row gutter={16} style={{ marginTop: 16 }}>
                    <Col xs={24} sm={12}>
                      <Text strong>Peak Month:</Text>
                      <div className="technical-number">Month {result.summary.peakMonth}</div>
                    </Col>
                    <Col xs={24} sm={12}>
                      <Text strong>Peak Lift:</Text>
                      <div className="technical-number">{result.summary.peakLiftPercent.toFixed(1)}%</div>
                    </Col>
                  </Row>
                  {result.summary.breakdown && (
                    <>
                      <div style={{ marginTop: 24, marginBottom: 8 }}>
                        <Text strong>Impact Breakdown:</Text>
                      </div>
                      <Row gutter={16}>
                        <Col xs={24} sm={8}>
                          <Text type="secondary">Existing Users:</Text>
                          <div className="technical-number">{(result.summary.breakdown.existingUsers / 1000000).toFixed(2)}M</div>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Text type="secondary">New Users:</Text>
                          <div className="technical-number">{(result.summary.breakdown.newUsers / 1000000).toFixed(2)}M</div>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Text type="secondary">New Acquisition:</Text>
                          <div className="technical-number">{(result.summary.breakdown.newAcquisition / 1000000).toFixed(2)}M</div>
                        </Col>
                      </Row>
                    </>
                  )}
                  {result.retentionCurves && (
                    <>
                      <div style={{ marginTop: 24, marginBottom: 8 }}>
                        <Text strong>Model Quality (R²):</Text>
                      </div>
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Text type="secondary">New Users:</Text>
                          <div className="technical-number">{result.retentionCurves.baseNewUser.rSquared?.toFixed(3) || 'N/A'}</div>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Text type="secondary">Existing Users:</Text>
                          <div className="technical-number">{result.retentionCurves.baseExistingUser.rSquared?.toFixed(3) || 'N/A'}</div>
                        </Col>
                      </Row>
                    </>
                  )}
                </Card>
              </Space>
            )}
          </Col>
        </Row>
          </TabPane>
          
          <TabPane tab="Baseline Data" key="2">
            <div style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                onClick={handleEditBaseline}
                disabled={editingBaseline}
              >
                {editingBaseline ? 'Editing...' : 'Edit Baseline Data'}
              </Button>
              {editingBaseline && (
                <Space style={{ marginLeft: 8 }}>
                  <Button onClick={handleCancelBaseline}>Cancel</Button>
                </Space>
              )}
            </div>

            {!editingBaseline && baselineData && (
              <Row gutter={24}>
                <Col xs={24} lg={12}>
                  <Card title="Current DAU by Segment/Platform">
                    <Row gutter={16}>
                      {Object.entries(baselineData.currentDAU).map(([key, value]) => (
                        <Col xs={12} sm={12} key={key}>
                          <Text type="secondary">{key.replace('_', ' ').toUpperCase()}:</Text>
                          <div className="technical-number">{(value as number / 1000000).toFixed(2)}M</div>
                        </Col>
                      ))}
                    </Row>
                    <div style={{ marginTop: 16, padding: '8px', backgroundColor: isDarkMode ? '#262626' : '#f5f5f5', borderRadius: '4px' }}>
                      <Text strong>Total Current DAU: </Text>
                      <span className="technical-number">{(baselineData.totalCurrentDAU / 1000000).toFixed(2)}M</span>
                    </div>
                  </Card>
                </Col>
                
                <Col xs={24} lg={12}>
                  <Card title="Weekly Acquisitions by Segment/Platform">
                    <Row gutter={16}>
                      {Object.entries(baselineData.weeklyAcquisitions).map(([key, value]) => (
                        <Col xs={12} sm={12} key={key}>
                          <Text type="secondary">{key.replace('_', ' ').toUpperCase()}:</Text>
                          <div className="technical-number">{(value as number / 1000).toFixed(0)}K/week</div>
                        </Col>
                      ))}
                    </Row>
                    <div style={{ marginTop: 16, padding: '8px', backgroundColor: isDarkMode ? '#262626' : '#f5f5f5', borderRadius: '4px' }}>
                      <Text strong>Total Weekly: </Text>
                      <span className="technical-number">{(baselineData.totalWeeklyAcquisitions / 1000).toFixed(0)}K</span>
                      <br />
                      <Text strong>Daily: </Text>
                      <span className="technical-number">{(baselineData.dailyAcquisitions / 1000).toFixed(0)}K</span>
                    </div>
                  </Card>
                </Col>
              </Row>
            )}

            {editingBaseline && (
              <Form
                form={baselineForm}
                layout="vertical"
                onFinish={handleSaveBaseline}
              >
                <Row gutter={24}>
                  <Col xs={24} lg={12}>
                    <Card title="Current DAU by Segment/Platform">
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['currentDAU', 'commercial_ios']} label="Commercial iOS">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['currentDAU', 'commercial_android']} label="Commercial Android">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['currentDAU', 'consumer_ios']} label="Consumer iOS">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['currentDAU', 'consumer_android']} label="Consumer Android">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                  
                  <Col xs={24} lg={12}>
                    <Card title="Weekly Acquisitions by Segment/Platform">
                      <Row gutter={16}>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['weeklyAcquisitions', 'commercial_ios']} label="Commercial iOS">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['weeklyAcquisitions', 'commercial_android']} label="Commercial Android">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['weeklyAcquisitions', 'consumer_ios']} label="Consumer iOS">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                          <Form.Item name={['weeklyAcquisitions', 'consumer_android']} label="Consumer Android">
                            <InputNumber style={{ width: '100%' }} min={0} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>
                
                <Row gutter={24} style={{ marginTop: 24 }}>
                  <Col xs={24} lg={12}>
                    <Card title="Retention Curves - New Users (%)">
                      <Row gutter={16}>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'new', 'd1']} label="D1">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'new', 'd7']} label="D7">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'new', 'd14']} label="D14">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'new', 'd28']} label="D28">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'new', 'd360']} label="D360">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'new', 'd720']} label="D720">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                  
                  <Col xs={24} lg={12}>
                    <Card title="Retention Curves - Existing Users (%)">
                      <Row gutter={16}>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'existing', 'd1']} label="D1">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'existing', 'd7']} label="D7">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'existing', 'd14']} label="D14">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'existing', 'd28']} label="D28">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'existing', 'd360']} label="D360">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                          <Form.Item name={['retentionCurves', 'existing', 'd720']} label="D720">
                            <InputNumber style={{ width: '100%' }} min={0} max={100} step={0.1} />
                          </Form.Item>
                        </Col>
                      </Row>
                    </Card>
                  </Col>
                </Row>
                
                <div style={{ marginTop: 24, textAlign: 'center' }}>
                  <Button type="primary" htmlType="submit" size="large">
                    Save Baseline Data
                  </Button>
                </div>
              </Form>
            )}
            
            {baselineData && (
              <Row gutter={24} style={{ marginTop: 24 }}>
                <Col xs={24} lg={12}>
                  <Card title="Baseline Retention Curves - New Users">
                    <Row gutter={16}>
                      {Object.entries(baselineData.retentionCurves.new).map(([day, value]) => (
                        <Col xs={12} sm={8} md={4} key={day}>
                          <div>
                            <Text type="secondary">{day.toUpperCase()}:</Text>
                            <div className="technical-number">{value as number}%</div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                </Col>
                
                <Col xs={24} lg={12}>
                  <Card title="Baseline Retention Curves - Existing Users">
                    <Row gutter={16}>
                      {Object.entries(baselineData.retentionCurves.existing).map(([day, value]) => (
                        <Col xs={12} sm={8} md={4} key={day}>
                          <div>
                            <Text type="secondary">{day.toUpperCase()}:</Text>
                            <div className="technical-number">{value as number}%</div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                </Col>
              </Row>
            )}
            
            {baselineData && (
              <Row gutter={24} style={{ marginTop: 24 }}>
                <Col xs={24}>
                  <Card title="Key Assumptions">
                    <Row gutter={16}>
                      <Col xs={24} sm={8}>
                        <Text type="secondary">Daily Churn Rate:</Text>
                        <div className="technical-number">0.17% (5% monthly)</div>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Text type="secondary">New User Model:</Text>
                        <div className="technical-number">Power Curve: retention(t) = a × t^(-b)</div>
                      </Col>
                      <Col xs={24} sm={8}>
                        <Text type="secondary">Existing User Model:</Text>
                        <div className="technical-number">Exponential: retention(t) = c + a × e^(-λt)</div>
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            )}
          </TabPane>
        </Tabs>
      </Content>
    </Layout>
    </ConfigProvider>
  );
}

export default App;
