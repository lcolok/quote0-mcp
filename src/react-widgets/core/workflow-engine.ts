/**
 * 工作流引擎 - 串联数据源、处理和渲染模块
 */

import { 
  WorkflowDefinition, 
  WorkflowNode, 
  WorkflowConnection, 
  WorkflowExecutionResult,
  DataSourceModule,
  ProcessingModule,
  RenderingModule,
  DataSourceParams,
  ProcessingParams,
  RenderingParams,
  RenderingConfig
} from './modular-architecture.js';

import { dataSourceRegistry } from './data-source-modules.js';
import { processingRegistry } from './processing-modules.js';
import { renderingRegistry } from './rendering-modules.js';

/**
 * 工作流执行上下文
 */
interface WorkflowExecutionContext {
  executionId: string;
  startTime: string;
  nodeResults: Record<string, any>;
  nodesDuration: Record<string, number>;
  currentNode?: string;
  error?: string;
}

/**
 * 工作流引擎
 */
export class WorkflowEngine {
  private static instance: WorkflowEngine;
  
  static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }
  
  private constructor() {}
  
  /**
   * 执行工作流
   */
  async executeWorkflow(workflow: WorkflowDefinition): Promise<WorkflowExecutionResult> {
    const context: WorkflowExecutionContext = {
      executionId: this.generateExecutionId(),
      startTime: new Date().toISOString(),
      nodeResults: {},
      nodesDuration: {}
    };
    
    console.log(`🚀 工作流开始执行: ${workflow.name} (${context.executionId})`);
    
    try {
      // 验证工作流定义
      this.validateWorkflow(workflow);
      
      // 构建节点执行顺序
      const executionOrder = this.buildExecutionOrder(workflow);
      console.log(`📋 节点执行顺序: ${executionOrder.map(node => node.name).join(' -> ')}`);
      
      // 按顺序执行节点
      for (const node of executionOrder) {
        context.currentNode = node.id;
        const nodeStartTime = Date.now();
        
        console.log(`📝 执行节点: ${node.name} (${node.type})`);
        
        try {
          const result = await this.executeNode(node, context);
          context.nodeResults[node.id] = result;
          context.nodesDuration[node.id] = Date.now() - nodeStartTime;
          
          console.log(`✅ 节点完成: ${node.name} (耗时${context.nodesDuration[node.id]}ms)`);
          
        } catch (error) {
          const errorMsg = `节点执行失败: ${node.name} - ${error instanceof Error ? error.message : '未知错误'}`;
          console.error(`❌ ${errorMsg}`);
          
          context.error = errorMsg;
          context.nodesDuration[node.id] = Date.now() - nodeStartTime;
          
          return this.buildErrorResult(workflow, context, errorMsg);
        }
      }
      
      // 获取最终结果
      const finalNode = executionOrder[executionOrder.length - 1];
      const finalResult = context.nodeResults[finalNode.id];
      
      const result: WorkflowExecutionResult = {
        workflowId: workflow.id,
        executionId: context.executionId,
        startTime: context.startTime,
        endTime: new Date().toISOString(),
        status: 'success',
        result: finalResult,
        nodeResults: context.nodeResults,
        metrics: {
          totalDuration: Date.now() - new Date(context.startTime).getTime(),
          nodesDuration: context.nodesDuration
        }
      };
      
      console.log(`✅ 工作流执行成功: ${workflow.name} (总耗时${result.metrics.totalDuration}ms)`);
      return result;
      
    } catch (error) {
      const errorMsg = `工作流执行失败: ${error instanceof Error ? error.message : '未知错误'}`;
      console.error(`❌ ${errorMsg}`);
      
      return this.buildErrorResult(workflow, context, errorMsg);
    }
  }

  /**
   * 只执行数据源和处理器节点，返回可供多个目标尺寸复用的处理结果。
   *
   * 本地 E-Ink 不能先渲染一个默认尺寸再缩放；它需要把同一份处理结果
   * 交给每个 RenderTarget 独立排版。因此这里明确提供一个不经过渲染节点
   * 的工作流入口。
   */
  async executeUntilProcessing(workflow: WorkflowDefinition): Promise<any> {
    const context: WorkflowExecutionContext = {
      executionId: this.generateExecutionId(),
      startTime: new Date().toISOString(),
      nodeResults: {},
      nodesDuration: {}
    };

    this.validateWorkflow(workflow);
    const executionOrder = this.buildExecutionOrder(workflow);
    const processingIndex = executionOrder.findIndex((node) => node.type === 'processing');
    if (processingIndex < 0) {
      throw new Error('工作流未包含处理节点');
    }

    for (const node of executionOrder.slice(0, processingIndex + 1)) {
      context.currentNode = node.id;
      const nodeStartTime = Date.now();
      const result = await this.executeNode(node, context);
      context.nodeResults[node.id] = result;
      context.nodesDuration[node.id] = Date.now() - nodeStartTime;
    }

    return context.nodeResults[executionOrder[processingIndex].id];
  }
  
  /**
   * 验证工作流定义
   */
  private validateWorkflow(workflow: WorkflowDefinition): void {
    if (!workflow.nodes || workflow.nodes.length === 0) {
      throw new Error('工作流必须包含至少一个节点');
    }
    
    // 检查节点类型顺序
    const nodeTypes = workflow.nodes.map(node => node.type);
    const expectedOrder = ['datasource', 'processing', 'rendering'];
    
    let expectedIndex = 0;
    for (const nodeType of nodeTypes) {
      const currentExpectedType = expectedOrder[expectedIndex];
      
      if (nodeType === currentExpectedType) {
        expectedIndex++;
      } else if (expectedIndex > 0 && nodeType === expectedOrder[expectedIndex - 1]) {
        // 允许同类型的多个节点
        continue;
      } else {
        throw new Error(`工作流节点类型顺序错误: 期望 ${currentExpectedType}，实际 ${nodeType}`);
      }
    }
    
    // 验证连接
    for (const connection of workflow.connections) {
      const fromNode = workflow.nodes.find(n => n.id === connection.from);
      const toNode = workflow.nodes.find(n => n.id === connection.to);
      
      if (!fromNode) {
        throw new Error(`连接源节点不存在: ${connection.from}`);
      }
      if (!toNode) {
        throw new Error(`连接目标节点不存在: ${connection.to}`);
      }
    }
  }
  
  /**
   * 构建节点执行顺序
   */
  private buildExecutionOrder(workflow: WorkflowDefinition): WorkflowNode[] {
    // 简化实现：假设节点已经按照正确的依赖顺序排列
    // 在实际应用中，这里需要实现拓扑排序算法
    return [...workflow.nodes];
  }
  
  /**
   * 执行单个节点
   */
  private async executeNode(node: WorkflowNode, context: WorkflowExecutionContext): Promise<any> {
    switch (node.type) {
      case 'datasource':
        return await this.executeDataSourceNode(node, context);
      case 'processing':
        return await this.executeProcessingNode(node, context);
      case 'rendering':
        return await this.executeRenderingNode(node, context);
      default:
        throw new Error(`不支持的节点类型: ${node.type}`);
    }
  }
  
  /**
   * 执行数据源节点
   */
  private async executeDataSourceNode(node: WorkflowNode, context: WorkflowExecutionContext): Promise<any> {
    const module = node.module as DataSourceModule;
    const params = node.params as DataSourceParams;
    
    // 验证参数
    if (!module.validateParams(params)) {
      throw new Error(`数据源节点参数验证失败: ${node.name}`);
    }
    
    // 执行数据获取
    const rawDataList = await module.fetchRawData(params);
    
    // 通常我们只处理第一条数据，但也支持批量处理
    return rawDataList.length > 0 ? rawDataList[0] : null;
  }
  
  /**
   * 执行处理节点
   */
  private async executeProcessingNode(node: WorkflowNode, context: WorkflowExecutionContext): Promise<any> {
    const module = node.module as ProcessingModule;
    const params = node.params as ProcessingParams;
    
    // 获取前一个节点的输出作为输入
    const previousNodeIds = this.getPreviousNodeIds(node.id, context);
    if (previousNodeIds.length === 0) {
      throw new Error(`处理节点没有输入数据: ${node.name}`);
    }
    
    const inputData = context.nodeResults[previousNodeIds[0]];
    if (!inputData) {
      throw new Error(`处理节点输入数据为空: ${node.name}`);
    }
    
    // 验证参数
    if (!module.validateParams(params)) {
      throw new Error(`处理节点参数验证失败: ${node.name}`);
    }
    
    // 执行数据处理
    return await module.processData(inputData, params);
  }
  
  /**
   * 执行渲染节点
   */
  private async executeRenderingNode(node: WorkflowNode, context: WorkflowExecutionContext): Promise<any> {
    const module = node.module as RenderingModule;
    const params = node.params as RenderingParams;
    const config = node.config as RenderingConfig || {};
    
    // 获取前一个节点的输出作为输入
    const previousNodeIds = this.getPreviousNodeIds(node.id, context);
    
    if (previousNodeIds.length === 0) {
      throw new Error(`渲染节点没有输入数据: ${node.name}`);
    }
    
    // 取最后一个执行的节点作为输入（应该是处理器）
    const inputNodeId = previousNodeIds[previousNodeIds.length - 1];
    const processedData = context.nodeResults[inputNodeId];
    
    if (!processedData) {
      throw new Error(`渲染节点输入数据为空: ${node.name}`);
    }
    
    // 验证参数
    if (!module.validateParams(params)) {
      throw new Error(`渲染节点参数验证失败: ${node.name}`);
    }
    
    // 转换数据格式
    const renderableData = module.transformToRenderable(processedData, params);
    
    // 执行渲染
    return await module.render(renderableData, config);
  }
  
  /**
   * 获取前一个节点的ID列表
   */
  private getPreviousNodeIds(nodeId: string, context: WorkflowExecutionContext): string[] {
    // 简化实现：返回已执行的节点ID
    return Object.keys(context.nodeResults);
  }
  
  /**
   * 构建错误结果
   */
  private buildErrorResult(workflow: WorkflowDefinition, context: WorkflowExecutionContext, error: string): WorkflowExecutionResult {
    return {
      workflowId: workflow.id,
      executionId: context.executionId,
      startTime: context.startTime,
      endTime: new Date().toISOString(),
      status: 'error',
      result: null,
      error,
      nodeResults: context.nodeResults,
      metrics: {
        totalDuration: Date.now() - new Date(context.startTime).getTime(),
        nodesDuration: context.nodesDuration
      }
    };
  }
  
  /**
   * 生成执行ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
  
  /**
   * 创建预定义的新闻工作流
   */
  createNewsWorkflow(config: {
    dataSource: string;
    dataSourceParams: DataSourceParams;
    processor: string;
    processingParams: ProcessingParams;
    renderer?: string;
    renderingParams?: RenderingParams;
    renderingConfig?: RenderingConfig;
  }): WorkflowDefinition {
    // 获取模块实例
    const dataSourceModule = dataSourceRegistry.get(config.dataSource);
    if (!dataSourceModule) {
      throw new Error(`数据源模块未找到: ${config.dataSource}`);
    }
    
    const processingModule = processingRegistry.get(config.processor);
    if (!processingModule) {
      throw new Error(`处理模块未找到: ${config.processor}`);
    }
    
    const rendererName = config.renderer || 'news';
    const renderingModule = renderingRegistry.get(rendererName);
    if (!renderingModule) {
      throw new Error(`渲染模块未找到: ${rendererName}`);
    }
    
    // 构建工作流
    const workflowId = `news_workflow_${Date.now()}`;
    
    const workflow: WorkflowDefinition = {
      id: workflowId,
      name: `新闻处理工作流 (${config.dataSource} -> ${config.processor} -> ${rendererName})`,
      description: `从${config.dataSource}获取数据，使用${config.processor}处理，通过${rendererName}渲染`,
      nodes: [
        {
          id: `${workflowId}_datasource`,
          name: `数据源: ${dataSourceModule.name}`,
          type: 'datasource',
          module: dataSourceModule,
          params: config.dataSourceParams
        },
        {
          id: `${workflowId}_processing`,
          name: `处理器: ${processingModule.name}`,
          type: 'processing',
          module: processingModule,
          params: config.processingParams
        },
        {
          id: `${workflowId}_rendering`,
          name: `渲染器: ${renderingModule.name}`,
          type: 'rendering',
          module: renderingModule,
          params: config.renderingParams || {},
          config: config.renderingConfig || {}
        }
      ],
      connections: [
        {
          from: `${workflowId}_datasource`,
          to: `${workflowId}_processing`
        },
        {
          from: `${workflowId}_processing`,
          to: `${workflowId}_rendering`
        }
      ],
      metadata: {
        createdAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };
    
    return workflow;
  }
}

/**
 * 工作流构建器 - 提供流畅的API来构建工作流
 */
export class WorkflowBuilder {
  private workflow: Partial<WorkflowDefinition> = {
    nodes: [],
    connections: [],
    metadata: {}
  };
  
  constructor(id?: string, name?: string) {
    this.workflow.id = id || `workflow_${Date.now()}`;
    this.workflow.name = name || '未命名工作流';
  }
  
  description(desc: string): WorkflowBuilder {
    this.workflow.description = desc;
    return this;
  }
  
  addDataSource(name: string, moduleName: string, params: DataSourceParams): WorkflowBuilder {
    const module = dataSourceRegistry.get(moduleName);
    if (!module) {
      throw new Error(`数据源模块未找到: ${moduleName}`);
    }
    
    const nodeId = `${this.workflow.id}_${name}`;
    this.workflow.nodes!.push({
      id: nodeId,
      name: `数据源: ${name}`,
      type: 'datasource',
      module,
      params
    });
    
    return this;
  }
  
  addProcessor(name: string, moduleName: string, params: ProcessingParams): WorkflowBuilder {
    const module = processingRegistry.get(moduleName);
    if (!module) {
      throw new Error(`处理模块未找到: ${moduleName}`);
    }
    
    const nodeId = `${this.workflow.id}_${name}`;
    this.workflow.nodes!.push({
      id: nodeId,
      name: `处理器: ${name}`,
      type: 'processing',
      module,
      params
    });
    
    return this;
  }
  
  addRenderer(name: string, moduleName: string, params: RenderingParams, config?: RenderingConfig): WorkflowBuilder {
    const module = renderingRegistry.get(moduleName);
    if (!module) {
      throw new Error(`渲染模块未找到: ${moduleName}`);
    }
    
    const nodeId = `${this.workflow.id}_${name}`;
    this.workflow.nodes!.push({
      id: nodeId,
      name: `渲染器: ${name}`,
      type: 'rendering',
      module,
      params,
      config
    });
    
    return this;
  }
  
  connect(from: string, to: string): WorkflowBuilder {
    const fromNodeId = `${this.workflow.id}_${from}`;
    const toNodeId = `${this.workflow.id}_${to}`;
    
    this.workflow.connections!.push({
      from: fromNodeId,
      to: toNodeId
    });
    
    return this;
  }
  
  build(): WorkflowDefinition {
    if (!this.workflow.id || !this.workflow.name || !this.workflow.nodes || this.workflow.nodes.length === 0) {
      throw new Error('工作流构建不完整');
    }
    
    return this.workflow as WorkflowDefinition;
  }
}

// 导出工作流引擎实例
export const workflowEngine = WorkflowEngine.getInstance();
