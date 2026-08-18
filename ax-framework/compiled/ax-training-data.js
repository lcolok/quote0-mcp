/**
 * AX框架训练数据集
 * 高质量的新闻处理示例，用于自动优化训练
 */
export const trainingData = [
    {
        newsContent: `英伟达和富士通宣布合作开发下一代超级计算机"富岳NEXT"，该系统将采用英伟达最新的Grace Hopper超级芯片架构，预计性能将比当前的富岳超算提升10倍以上。新系统将在2027年投入使用，主要用于气候建模、药物发现和人工智能研究。富士通表示，这标志着日本在超算领域的重大突破。`,
        expectedTitle: `英伟达富士通合作富岳`,
        expectedSummary: `英伟达与富士通合作开发"富岳NEXT"超算，采用Grace Hopper架构，性能提升10倍，2027年投用，用于气候建模、药物发现和AI研究。`,
        metadata: {
            category: 'technology',
            difficulty: 3,
            quality: 5
        }
    },
    {
        newsContent: `百度计划将其自动驾驶出租车服务扩展到海外市场，首站选择新加坡。该服务使用百度Apollo平台技术，已在中国多个城市运营两年，累计服务超过100万次。百度表示，此举是其全球化战略的重要一步，将与当地监管部门密切合作确保安全运营。`,
        expectedTitle: `百度自驾出租车出海`,
        expectedSummary: `百度将自动驾驶出租车服务扩展至新加坡，基于Apollo平台，已在中国运营两年，服务超100万次，是全球化战略重要步骤。`,
        metadata: {
            category: 'technology',
            difficulty: 2,
            quality: 4
        }
    },
    {
        newsContent: `OpenAI发布最新研究报告称，其GPT-5模型在多项基准测试中超越了人类专家水平，特别是在数学推理和科学问题解答方面。该模型预计将于2024年第四季度发布，将支持更长的上下文长度和多模态输入。然而，训练成本也相应增加了300%，这引发了业界对AI发展可持续性的讨论。`,
        expectedTitle: `GPT-5超越人类专家`,
        expectedSummary: `OpenAI研究显示GPT-5在数学推理和科学问答超越人类专家，Q4发布，支持长上下文和多模态，但训练成本增加300%。`,
        metadata: {
            category: 'ai',
            difficulty: 4,
            quality: 5
        }
    },
    {
        newsContent: `苹果公司宣布其iPhone 15系列销量超过预期，第一季度出货量达到5000万台，比iPhone 14同期增长15%。分析师认为，USB-C接口的采用和改进的摄像系统是推动销量增长的主要因素。苹果股价在消息公布后上涨3.5%。`,
        expectedTitle: `iPhone15销量超预期`,
        expectedSummary: `iPhone 15系列Q1出货5000万台，比14系列同期增长15%，USB-C接口和改进摄像头推动增长，苹果股价涨3.5%。`,
        metadata: {
            category: 'business',
            difficulty: 1,
            quality: 3
        }
    },
    {
        newsContent: `特斯拉在中国上海的超级工厂创下新的生产记录，单月产量突破10万辆Model Y。该工厂自2019年投产以来，已累计生产超过300万辆电动汽车。特斯拉表示，这得益于持续的工艺优化和供应链改进，未来计划进一步扩大产能。`,
        expectedTitle: `特斯拉上海厂破纪录`,
        expectedSummary: `特斯拉上海超级工厂单月生产10万辆Model Y创纪录，自2019年已产300万辆，得益于工艺优化，计划扩产。`,
        metadata: {
            category: 'automotive',
            difficulty: 2,
            quality: 4
        }
    },
    {
        newsContent: `微软Azure云服务遭遇大规模故障，影响全球多个地区的用户访问。故障持续约6小时，导致Teams、Outlook等核心服务无法正常使用。微软工程团队已修复问题，并承诺为受影响客户提供服务积分补偿。这是微软本年度第三次重大服务中断。`,
        expectedTitle: `微软Azure大规模故障`,
        expectedSummary: `微软Azure云服务故障6小时，Teams和Outlook等服务受影响，已修复并承诺补偿，这是本年第三次重大中断。`,
        metadata: {
            category: 'technology',
            difficulty: 2,
            quality: 4
        }
    },
    {
        newsContent: `中国空间站"天和"核心舱成功完成第四次轨道提升，目前运行在距离地球423公里的轨道上。此次调整为即将到来的货运飞船对接做准备，预计下个月将有新的科学实验设备运抵空间站。中国载人航天工程办公室表示，空间站各系统运行正常。`,
        expectedTitle: `天和核心舱轨道提升`,
        expectedSummary: `中国空间站"天和"核心舱完成第四次轨道提升至423公里轨道，为货运飞船对接做准备，各系统运行正常。`,
        metadata: {
            category: 'space',
            difficulty: 3,
            quality: 4
        }
    },
    {
        newsContent: `量子计算公司IonQ发布其最新量子处理器Forte，声称在特定计算任务上比传统超级计算机快1000倍。该处理器采用被困离子技术，拥有32个量子比特，误差率降至0.1%以下。专家认为这标志着量子计算向实用化迈进了重要一步，但距离大规模商业应用仍需时日。`,
        expectedTitle: `IonQ发布量子处理器`,
        expectedSummary: `IonQ发布Forte量子处理器，32量子比特，特定任务比超算快1000倍，误差率低于0.1%，向实用化迈进重要一步。`,
        metadata: {
            category: 'quantum',
            difficulty: 5,
            quality: 5
        }
    }
];
/**
 * 训练数据评价指标
 */
export const evaluationCriteria = {
    title: {
        maxLength: 20,
        minLength: 5,
        weights: {
            lengthCompliance: 0.4,
            informationDensity: 0.3,
            readability: 0.3
        }
    },
    summary: {
        maxLength: 200,
        minLength: 50,
        weights: {
            lengthCompliance: 0.3,
            accuracy: 0.4,
            completeness: 0.3
        }
    }
};
//# sourceMappingURL=ax-training-data.js.map