import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Checkbox, Card, Typography, Alert, Flex, message } from 'antd';
import { UserOutlined, LockOutlined, GoogleOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

const Login = () => {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onFinish = ({ username, password }) => {
    setError('');
    setSubmitting(true);

    setTimeout(() => {
      setSubmitting(false);
      if (username && password) {
        navigate('/home');
      } else {
        setError('Invalid username or password.');
      }
    }, 400);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f2f5',
      }}
    >
      <Card style={{ width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={3} style={{ marginBottom: 4 }}>
            Sign in
          </Title>
          <Text type="secondary">Welcome back, please enter your details.</Text>
        </div>

        {error && (
          <Alert
            type="error"
            message={error}
            style={{ marginBottom: 16 }}
            showIcon
          />
        )}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Please enter your username' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="Username" size="large" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>

          <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 12 }}>
            <Checkbox>Remember me</Checkbox>
          </Form.Item>

          <Form.Item>
            <Flex gap={12}>
              <Button type="primary" htmlType="submit" size="large" loading={submitting} style={{ flex: 1 }}>
                Sign in
              </Button>
              <Button
                size="large"
                icon={<GoogleOutlined />}
                style={{ flex: 1 }}
                onClick={() => message.info('Google sign-in will be connected soon.')}
              >
                Google
              </Button>
            </Flex>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Login;
