import { useState } from 'react';
import { Layout, Menu, Button, Dropdown, Card, Row, Col, Statistic, Avatar, Typography } from 'antd';
import {
  DashboardOutlined,
  BarChartOutlined,
  EnvironmentOutlined,
  SettingOutlined,
  DownOutlined,
  UserOutlined,
  LogoutOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { logout } from './auth.js';

const { Sider, Header, Content, Footer } = Layout;
const { Title, Text } = Typography;

const NAV_ITEMS = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: 'analytics', icon: <BarChartOutlined />, label: 'Analytics' },
  { key: 'cities', icon: <EnvironmentOutlined />, label: 'Cities' },
  { key: 'settings', icon: <SettingOutlined />, label: 'Settings' },
];

const STATS = [
  { title: 'Total Users', value: 12480, prefix: <ArrowUpOutlined />, valueStyle: { color: '#3f8600' }, suffix: '+4.2%' },
  { title: 'Revenue', value: 84250, prefix: '$', valueStyle: { color: '#3f8600' } },
  { title: 'Active Sessions', value: 342, valueStyle: { color: '#1677ff' } },
  { title: 'Churn Rate', value: 2.4, prefix: <ArrowDownOutlined />, valueStyle: { color: '#cf1322' }, suffix: '%' },
];

const Home = () => {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [selectedKey, setSelectedKey] = useState('dashboard');

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const cityMenu = {
    items: [
      { key: '1', label: 'New York, NY' },
      { key: '2', label: 'Los Angeles, CA' },
      { key: '3', label: 'Chicago, IL' },
      { key: '4', label: 'Houston, TX' },
      { key: '5', label: 'Phoenix, AZ' },
      { key: '6', label: 'Philadelphia, PA' },
      { key: '7', label: 'San Antonio, TX' },
      { key: '8', label: 'San Diego, CA' },
      { key: '9', label: 'Dallas, TX' },
      { key: '10', label: 'San Jose, CA' },
    ],
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} breakpoint="lg">
        <div
          style={{
            height: 48,
            margin: 16,
            color: '#fff',
            fontWeight: 600,
            fontSize: collapsed ? 16 : 18,
            textAlign: 'center',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {collapsed ? 'BF' : 'BoardFoot'}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          onClick={({ key }) => setSelectedKey(key)}
          items={NAV_ITEMS}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxShadow: '0 1px 4px rgba(0,21,41,0.08)',
          }}
        >
          <Title level={4} style={{ margin: 0 }}>
            Dashboard
          </Title>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Avatar icon={<UserOutlined />} />
            <Text>admin</Text>
            <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </Header>

        <Content style={{ margin: 24 }}>
          <Row gutter={[16, 16]}>
            {STATS.map((stat) => (
              <Col xs={24} sm={12} lg={6} key={stat.title}>
                <Card>
                  <Statistic {...stat} />
                </Card>
              </Col>
            ))}
          </Row>

          <Card style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button type="primary" icon={<UserOutlined />}>
                Know More
              </Button>
              <Dropdown menu={cityMenu} trigger={['click']}>
                <Button>
                  Largest US Cities <DownOutlined />
                </Button>
              </Dropdown>
            </div>
          </Card>
        </Content>

        <Footer style={{ textAlign: 'center' }}>
          BoardFoot Calculator ©{new Date().getFullYear()} — All rights reserved
        </Footer>
      </Layout>
    </Layout>
  );
};

export default Home;
